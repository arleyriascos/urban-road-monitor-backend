import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GoogleAuthLibraryVerifier } from '../auth/google-token-verifier.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { errorHandler } from '../middlewares/error-handler.js';
import { requirePermission } from '../middlewares/require-permission.js';
import { requireSession } from '../middlewares/require-session.js';
import { AccountRepository } from '../repositories/account.repository.js';
import { AuthLogRepository } from '../repositories/auth-log.repository.js';
import { ClusteringRunRepository } from '../repositories/clustering-run.repository.js';
import { ConsolidationRepository } from '../repositories/consolidation.repository.js';
import { ParameterRepository } from '../repositories/parameter.repository.js';
import { RoleAdminRepository } from '../repositories/role-admin.repository.js';
import { SessionRepository } from '../repositories/session.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import { createAuthRouter } from '../routes/auth.routes.js';
import { createClusteringRouter } from '../routes/clustering.routes.js';
import { AccountService } from '../services/account.service.js';
import { ClusteringAdminService } from '../services/clustering-admin.service.js';
import { ConsolidationCoordinator } from '../services/consolidation-coordinator.js';
import { ConsolidationService } from '../services/consolidation.service.js';
import { GoogleLoginService } from '../services/google-login.service.js';
import { SessionService } from '../services/session.service.js';
import { FakeGoogle, TEST_CLIENT_ID } from '../test/google-test-keys.js';
import { createTestClient, resetDatabase, testDatabaseUrl } from '../test/test-database.js';
import { AuthController } from './auth.controller.js';
import { ClusteringController } from './clustering.controller.js';

/**
 * The administrator's consolidation routes, against a real PostgreSQL: who may use them, a run
 * that starts and is recorded, and the refusal while one is going on. Skipped without
 * TEST_DATABASE_URL.
 */
const url = testDatabaseUrl();

interface Json {
  [key: string]: unknown;
}

describe.skipIf(!url)('consolidation routes, end to end (real database)', () => {
  let db: PrismaClient;
  let google: FakeGoogle;
  let baseUrl: string;
  let close: () => Promise<unknown>;
  let coordinator: ConsolidationCoordinator;
  let openGate: () => void;
  let gate: Promise<void>;

  beforeAll(async () => {
    db = createTestClient(url!);
    google = new FakeGoogle();
    const authLogs = new AuthLogRepository(db);
    const sessions = new SessionService(new SessionRepository(db), authLogs);
    const accounts = new AccountService(new AccountRepository(db));
    const login = new GoogleLoginService(
      new GoogleAuthLibraryVerifier(TEST_CLIENT_ID, google.client()),
      new UserRepository(db),
      sessions,
      authLogs,
    );
    const runs = new ClusteringRunRepository(db);
    const store = new ConsolidationRepository(db);
    const service = new ConsolidationService({
      runs,
      // The test holds the run at a gate it opens, so a run can be "going on".
      store: {
        loadDetections: async (since, limit) => {
          await gate;
          return store.loadDetections(since, limit);
        },
        loadDerivedPotholes: () => store.loadDerivedPotholes(),
        apply: (plan, runId) => store.apply(plan, runId),
      },
      parameters: new ParameterRepository(db),
      versions: { current: async () => 'test-version' },
      // With no detections the AI service is never asked, so any answer will do.
      ai: { cluster: async () => Promise.reject(new Error('not expected')) },
    });
    coordinator = new ConsolidationCoordinator({ service, runs });

    const open = (_req: unknown, _res: unknown, next: () => void) => next();
    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      createAuthRouter(
        new AuthController(login, accounts, sessions),
        open,
        requireSession(sessions),
      ),
    );
    app.use(
      '/api',
      createClusteringRouter(
        new ClusteringController(new ClusteringAdminService(coordinator, runs)),
        open,
        requirePermission('clustering.run', { sessions, accounts }),
      ),
    );
    app.use(errorHandler);
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((resolve) => server.close(resolve));
  });

  afterAll(async () => {
    await coordinator.stop();
    await close();
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
    await db.$executeRawUnsafe('DELETE FROM clustering_runs');
    gate = new Promise((resolve) => (openGate = resolve));
  });

  async function call(method: string, path: string, token?: string) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as Json };
  }

  async function person(email: string, role: 'colaborador' | 'administrador'): Promise<string> {
    const signed = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential: google.idToken({ email, sub: `sub-${email}` }) }),
    });
    expect(signed.status).toBe(200);
    await new RoleAdminRepository(db).change({ action: 'add', email, role }, new Date());
    return ((await signed.json()) as Json).token as string;
  }

  it('refuses a stranger and a collaborator, and lets the administrator in', async () => {
    const collaborator = await person('ana@example.com', 'colaborador');
    const admin = await person('root@example.com', 'administrador');

    expect((await call('GET', '/api/clustering/runs')).status).toBe(401);
    expect((await call('POST', '/api/clustering/runs')).status).toBe(401);
    expect((await call('GET', '/api/clustering/runs', collaborator)).status).toBe(403);
    expect((await call('POST', '/api/clustering/runs', collaborator)).status).toBe(403);

    openGate();
    const seen = await call('GET', '/api/clustering/runs', admin);
    expect(seen.status).toBe(200);
    expect(seen.body).toMatchObject({
      status: { running: false, failuresInARow: 0, pendingDetections: 0 },
      runs: [],
    });
  });

  it('starts a run, refuses a second one while it goes on, and records how it ended', async () => {
    const admin = await person('root@example.com', 'administrador');

    const started = await call('POST', '/api/clustering/runs', admin);
    expect(started.status).toBe(202);
    expect(started.body.status).toBe('started');

    const second = await call('POST', '/api/clustering/runs', admin);
    expect(second.status).toBe(409);
    expect((second.body.error as Json).code).toBe('RUN_IN_PROGRESS');

    openGate();
    let overview = await call('GET', '/api/clustering/runs', admin);
    for (let i = 0; i < 50 && (overview.body.runs as Json[])[0]?.status !== 'finished'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      overview = await call('GET', '/api/clustering/runs', admin);
    }

    const [run] = overview.body.runs as Json[];
    expect(run).toMatchObject({ status: 'finished', trigger: 'manual', epsM: 5, minPoints: 2 });
    expect(run?.requestedBy).toEqual(expect.any(String));
  });

  it('refuses a wrong limit', async () => {
    const admin = await person('root@example.com', 'administrador');
    openGate();
    expect((await call('GET', '/api/clustering/runs?limit=0', admin)).status).toBe(400);
  });
});

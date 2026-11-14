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
import { RoleAdminRepository } from '../repositories/role-admin.repository.js';
import { SessionRepository } from '../repositories/session.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import { createAuthRouter } from '../routes/auth.routes.js';
import { AccountService } from '../services/account.service.js';
import { GoogleLoginService } from '../services/google-login.service.js';
import { SessionService } from '../services/session.service.js';
import { FakeGoogle, TEST_CLIENT_ID } from '../test/google-test-keys.js';
import { createTestClient, resetDatabase, testDatabaseUrl } from '../test/test-database.js';
import { AuthController } from './auth.controller.js';

/**
 * The whole life of a session, from the point of view of the web page, against a real
 * PostgreSQL: sign in with Google (a test key signs the token, nothing here touches Google),
 * ask who I am, get a role the way the administrator does, use it at once, and sign out.
 * Skipped without TEST_DATABASE_URL.
 */
const url = testDatabaseUrl();

interface Answer {
  token: string;
  user: { id: string; email: string; roles: string[]; permissions: string[] };
  error: { code: string };
}

describe.skipIf(!url)('sign in, /me, roles and sign out, end to end (real database)', () => {
  let db: PrismaClient;
  let google: FakeGoogle;
  let baseUrl: string;
  let close: () => Promise<unknown>;

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

    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      createAuthRouter(
        new AuthController(login, accounts, sessions),
        (_req, _res, next) => next(),
        requireSession(sessions),
      ),
    );
    app.get(
      '/api/detect',
      requirePermission('detections.create', { sessions, accounts }),
      (_req, res) => {
        res.status(200).json({ ok: true });
      },
    );
    app.use(errorHandler);
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((resolve) => server.close(resolve));
  });

  afterAll(async () => {
    await close();
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
  });

  async function call(method: 'GET' | 'POST', path: string, token?: string, body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'true-client-ip': '203.0.113.5',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return {
      status: response.status,
      cache: response.headers.get('cache-control'),
      body: (text ? JSON.parse(text) : null) as Answer | null,
    };
  }

  const signIn = async () => {
    const answer = await call('POST', '/api/auth/google', undefined, {
      credential: google.idToken(),
    });
    expect(answer.status).toBe(200);
    return answer.body!;
  };
  const me = (token: string) => call('GET', '/api/auth/me', token);
  const logout = (token: string) => call('POST', '/api/auth/logout', token);
  const detect = (token: string) => call('GET', '/api/detect', token);
  const eventTypes = async () =>
    (await db.auth_logs.findMany({ orderBy: { id: 'asc' } })).map((entry) => entry.event_type);

  it('follows a person from the first sign-in to the sign-out', async () => {
    const { token, user } = await signIn();

    // A new person is only "usuario": they see who they are and may do nothing special.
    const first = await me(token);
    expect(first.status).toBe(200);
    expect(first.cache).toBe('no-store');
    expect(first.body?.user).toMatchObject({
      email: 'ana@example.com',
      roles: ['usuario'],
      permissions: [],
    });
    expect((await detect(token)).status).toBe(403);

    // The administrator gives them a role (what npm run user:role does): it counts at once.
    const change = await new RoleAdminRepository(db).change(
      { action: 'add', email: 'ana@example.com', role: 'colaborador' },
      new Date(),
    );
    expect(change.status).toBe('changed');
    const promoted = await me(token);
    expect(promoted.body?.user.roles).toEqual(['colaborador', 'usuario']);
    expect(promoted.body?.user.permissions).toEqual([
      'detections.create',
      'potholes.report_repair',
      'routes.view_history',
      'trips.view_own',
    ]);
    expect((await detect(token)).status).toBe(200);

    // Signing out closes that session and nothing else, and the session is dead afterwards.
    const other = await signIn();
    expect((await logout(token)).status).toBe(204);
    expect((await me(token)).status).toBe(401);
    expect((await detect(token)).status).toBe(401);
    expect((await logout(token)).status).toBe(401);
    expect((await me(other.token)).status).toBe(200);
    expect(other.user.id).toBe(user.id);

    // The three requests with the dead session are noted as session_rejected, as before.
    expect(await eventTypes()).toEqual([
      'register',
      'login',
      'role_changed',
      'login',
      'logout',
      'session_rejected',
      'session_rejected',
      'session_rejected',
    ]);
  });

  it('answers 401 to a request with no session, a wrong one or a malformed one', async () => {
    expect((await me('')).status).toBe(401);
    expect((await me('not-a-session')).status).toBe(401);
    expect((await me('A'.repeat(43))).status).toBe(401);
    expect((await logout('A'.repeat(43))).status).toBe(401);
    expect((await detect('A'.repeat(43))).status).toBe(401);
    expect(await eventTypes()).toEqual([]);
  });

  it('closes the session of a person whose account was deactivated', async () => {
    const { token, user } = await signIn();
    await db.users.update({ where: { id: user.id }, data: { is_active: false } });
    expect((await me(token)).status).toBe(401);
    expect((await detect(token)).status).toBe(401);
  });
});

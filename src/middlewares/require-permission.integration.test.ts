import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AccountRepository } from '../repositories/account.repository.js';
import { AuthLogRepository } from '../repositories/auth-log.repository.js';
import { SessionRepository } from '../repositories/session.repository.js';
import { AccountService } from '../services/account.service.js';
import { SessionService } from '../services/session.service.js';
import {
  createTestClient,
  createTestUser,
  giveRole,
  resetDatabase,
  testDatabaseUrl,
} from '../test/test-database.js';
import { errorHandler } from './error-handler.js';
import { requirePermission } from './require-permission.js';
import { getAuth } from './require-session.js';

/**
 * requirePermission against a real PostgreSQL, with the roles and permissions of the seed
 * data (usuario: none, colaborador: four, administrador: all nine). The routes below exist
 * only for the test: the first real use is the detection endpoints of stage 4.
 * Skipped without TEST_DATABASE_URL.
 */
const url = testDatabaseUrl();

describe.skipIf(!url)('requirePermission with a real database', () => {
  let db: PrismaClient;
  let sessions: SessionService;
  let app: Express;

  beforeAll(() => {
    db = createTestClient(url!);
    sessions = new SessionService(new SessionRepository(db), new AuthLogRepository(db));
    const dependencies = { sessions, accounts: new AccountService(new AccountRepository(db)) };

    app = express();
    app.get('/detect', requirePermission('detections.create', dependencies), (_req, res) => {
      res.status(200).json({ route: 'detect', email: getAuth(res).email });
    });
    app.get('/manage', requirePermission('users.manage', dependencies), (_req, res) => {
      res.status(200).json({ route: 'manage' });
    });
    app.get('/typo', requirePermission('detections.creat', dependencies), (_req, res) => {
      res.status(200).json({ route: 'typo' });
    });
    app.use(errorHandler);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
  });

  async function get(path: string, token?: string) {
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const response = await fetch(`http://localhost:${port}${path}`, {
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'user-agent': 'Chrome en Android',
          'true-client-ip': '203.0.113.77',
        },
      });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  /** A person with the given roles and an open session. */
  async function personWith(roles: string[], email = 'ana@example.com') {
    const userId = await createTestUser(db, { email });
    for (const role of roles) {
      await giveRole(db, userId, role);
    }
    const { token } = await sessions.open(userId, 'Chrome en Android');
    return { userId, token };
  }

  const logs = () => db.auth_logs.findMany({ orderBy: { id: 'asc' } });

  it('refuses the base role everything: it has no permission of its own', async () => {
    const { token } = await personWith(['usuario']);

    expect((await get('/detect', token)).status).toBe(403);
    expect((await get('/manage', token)).status).toBe(403);
  });

  it('lets a collaborator do what the role grants and nothing more', async () => {
    const { token } = await personWith(['usuario', 'colaborador']);

    expect(await get('/detect', token)).toEqual({
      status: 200,
      body: { route: 'detect', email: 'ana@example.com' },
    });
    expect((await get('/manage', token)).status).toBe(403);
  });

  it('lets an administrator do everything the roles grant', async () => {
    const { token } = await personWith(['usuario', 'administrador']);

    expect((await get('/detect', token)).status).toBe(200);
    expect((await get('/manage', token)).status).toBe(200);
  });

  it('refuses everybody, administrators too, a route with a code no role grants', async () => {
    const { token } = await personWith(['usuario', 'administrador']);
    expect((await get('/typo', token)).status).toBe(403);
  });

  it('answers 403 with the same body whatever the missing permission', async () => {
    const { token } = await personWith(['usuario']);
    const first = await get('/detect', token);
    const second = await get('/manage', token);

    expect(first.body).toEqual({
      error: { code: 'FORBIDDEN', message: 'You do not have permission to do this' },
    });
    expect(second.body).toEqual(first.body);
  });

  it('answers 401, not 403, to a request with no session or a session nobody has', async () => {
    await personWith(['administrador']);

    expect((await get('/detect')).status).toBe(401);
    expect((await get('/detect', 'Z'.repeat(43))).status).toBe(401);
  });

  it('writes nothing to auth_logs when it refuses: a refusal is not an attack', async () => {
    const { token } = await personWith(['usuario']);

    await get('/detect', token);
    await get('/manage', token);
    await get('/detect', token);

    expect(await logs()).toHaveLength(0);
  });

  it('applies a promotion on the very next request, with the same session', async () => {
    const { userId, token } = await personWith(['usuario']);
    expect((await get('/detect', token)).status).toBe(403);

    await giveRole(db, userId, 'colaborador');

    expect((await get('/detect', token)).status).toBe(200);
  });

  it('applies a demotion on the very next request, with the same session', async () => {
    const { userId, token } = await personWith(['usuario', 'colaborador']);
    expect((await get('/detect', token)).status).toBe(200);

    const role = await db.roles.findUniqueOrThrow({ where: { name: 'colaborador' } });
    await db.user_roles.delete({
      where: { user_id_role_id: { user_id: userId, role_id: role.id } },
    });

    expect((await get('/detect', token)).status).toBe(403);
  });

  it('answers 401 once the person is deactivated, even if they are an administrator', async () => {
    const { userId, token } = await personWith(['administrador']);
    expect((await get('/manage', token)).status).toBe(200);

    await db.users.update({ where: { id: userId }, data: { is_active: false } });

    expect((await get('/manage', token)).status).toBe(401);
  });

  it('does not mix the permissions of two people', async () => {
    const ana = await personWith(['usuario', 'administrador'], 'ana@example.com');
    const luis = await personWith(['usuario'], 'luis@example.com');

    expect((await get('/manage', ana.token)).status).toBe(200);
    expect((await get('/manage', luis.token)).status).toBe(403);
  });
});

import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DAY_MS, MAX_SESSIONS_PER_USER } from '../auth/session-config.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AuthLogRepository } from '../repositories/auth-log.repository.js';
import { SessionRepository } from '../repositories/session.repository.js';
import { SessionService } from '../services/session.service.js';
import {
  createTestClient,
  createTestUser,
  resetDatabase,
  testDatabaseUrl,
} from '../test/test-database.js';
import { errorHandler } from './error-handler.js';
import { getAuth, requireSession } from './require-session.js';

/**
 * The whole chain (middleware, service, repositories) against a real PostgreSQL,
 * with a clock the test moves by hand. Skipped without TEST_DATABASE_URL.
 */
const url = testDatabaseUrl();
const T0 = new Date('2026-11-10T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

describe.skipIf(!url)('requireSession with a real database', () => {
  let db: PrismaClient;
  let now: Date;
  let service: SessionService;
  let app: Express;

  beforeAll(() => {
    db = createTestClient(url!);
    service = new SessionService(new SessionRepository(db), new AuthLogRepository(db), () => now);
    app = express();
    app.get('/public', (_req, res) => {
      res.status(200).json({ public: true });
    });
    app.get('/private', requireSession(service), (_req, res) => {
      res.status(200).json({ email: getAuth(res).email });
    });
    app.use(errorHandler);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
    now = T0;
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
      return { status: response.status, body: await response.json() };
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  async function signIn(email = 'ana@example.com') {
    const userId = await createTestUser(db, { email });
    const { token } = await service.open(userId, 'Chrome en Android');
    return { userId, token };
  }

  const logs = () => db.auth_logs.findMany({ orderBy: { id: 'asc' } });

  it('lets a person with a session in and tells who they are', async () => {
    const { token } = await signIn();
    expect(await get('/private', token)).toEqual({
      status: 200,
      body: { email: 'ana@example.com' },
    });
    expect(await logs()).toHaveLength(0);
  });

  it('answers 401 for an identifier nobody has, and writes no log', async () => {
    await signIn();
    const { status, body } = await get('/private', 'Z'.repeat(43));
    expect(status).toBe(401);
    expect(body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'A valid session is required' },
    });
    expect(await logs()).toHaveLength(0);
  });

  it('answers 401 right after the session is revoked, and logs why', async () => {
    const { userId, token } = await signIn();
    const session = await db.sessions.findFirstOrThrow({ where: { user_id: userId } });
    await service.revoke(session.id);

    expect((await get('/private', token)).status).toBe(401);

    const [entry] = await logs();
    expect(entry).toMatchObject({
      user_id: userId,
      event_type: 'session_rejected',
      success: false,
      reason: 'revoked',
      ip_address: '203.0.113.0',
      user_agent: 'Chrome en Android',
    });
    // The id of an audit row is a BigInt, which JSON cannot write by itself.
    const written = JSON.stringify(entry, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(written).not.toContain(token);
    expect(written).not.toContain('ana@example.com');
  });

  it('answers 401 once the session expired', async () => {
    const { token } = await signIn();
    now = new Date(T0.getTime() + 7 * DAY_MS + 1000);
    expect((await get('/private', token)).status).toBe(401);
    expect((await logs())[0]?.reason).toBe('expired');
  });

  it('answers 401 on the very next request after the person is deactivated', async () => {
    const { userId, token } = await signIn();
    expect((await get('/private', token)).status).toBe(200);

    await db.users.update({ where: { id: userId }, data: { is_active: false, deleted_at: now } });

    expect((await get('/private', token)).status).toBe(401);
    expect((await logs())[0]?.reason).toBe('user_inactive');
  });

  it('renews at most once an hour', async () => {
    const { userId, token } = await signIn();
    const expiry = async () =>
      (await db.sessions.findFirstOrThrow({ where: { user_id: userId } })).expires_at;
    const opened = await expiry();

    now = new Date(T0.getTime() + 30 * 60_000); // half an hour: not due
    await get('/private', token);
    expect(await expiry()).toEqual(opened);

    now = new Date(T0.getTime() + 2 * HOUR); // two hours: renewed
    await get('/private', token);
    const renewed = await expiry();
    expect(renewed.getTime()).toBe(now.getTime() + 7 * DAY_MS);

    now = new Date(now.getTime() + 5 * 60_000); // five minutes later: not again
    await get('/private', token);
    expect(await expiry()).toEqual(renewed);
  });

  it('never keeps a session past 30 days, however much it is used', async () => {
    const { userId, token } = await signIn();
    for (let day = 5; day <= 29; day += 4) {
      now = new Date(T0.getTime() + day * DAY_MS);
      expect((await get('/private', token)).status).toBe(200);
    }
    const session = await db.sessions.findFirstOrThrow({ where: { user_id: userId } });
    expect(session.expires_at.getTime()).toBeLessThanOrEqual(T0.getTime() + 30 * DAY_MS);

    now = new Date(T0.getTime() + 30 * DAY_MS + 1000);
    expect((await get('/private', token)).status).toBe(401);
  });

  it('revokes the least used session when a sixth one opens, and that token stops working', async () => {
    const userId = await createTestUser(db);
    const tokens: string[] = [];
    for (let index = 0; index < MAX_SESSIONS_PER_USER; index += 1) {
      now = new Date(T0.getTime() + index * 60_000);
      tokens.push((await service.open(userId)).token);
    }
    // The first one is used two hours later, so the second is now the one expiring first.
    now = new Date(T0.getTime() + 2 * HOUR);
    expect((await get('/private', tokens[0]!)).status).toBe(200);

    const sixth = (await service.open(userId)).token;

    expect((await get('/private', tokens[1]!)).status).toBe(401);
    for (const token of [tokens[0]!, tokens[2]!, tokens[3]!, tokens[4]!, sixth]) {
      expect((await get('/private', token)).status).toBe(200);
    }
  });

  it('does not touch the public routes, whatever happens to the session', async () => {
    const { userId, token } = await signIn();
    const session = await db.sessions.findFirstOrThrow({ where: { user_id: userId } });
    await service.revoke(session.id);

    expect((await get('/public', token)).status).toBe(200);
    expect((await get('/public', 'garbage')).status).toBe(200);
    expect(await logs()).toHaveLength(0);
  });
});

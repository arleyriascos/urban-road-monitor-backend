import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GoogleAuthLibraryVerifier } from '../auth/google-token-verifier.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { errorHandler } from '../middlewares/error-handler.js';
import { LOGIN_ATTEMPTS_PER_MINUTE, createRateLimit } from '../middlewares/rate-limit.js';
import { getAuth, requireSession } from '../middlewares/require-session.js';
import { AuthLogRepository } from '../repositories/auth-log.repository.js';
import { SessionRepository } from '../repositories/session.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import { createAuthRouter } from '../routes/auth.routes.js';
import { GoogleLoginService } from '../services/google-login.service.js';
import { SessionService } from '../services/session.service.js';
import { FakeGoogle, OTHER_CLIENT_ID, TEST_CLIENT_ID } from '../test/google-test-keys.js';
import {
  createTestClient,
  createTestUser,
  resetDatabase,
  testDatabaseUrl,
} from '../test/test-database.js';
import { AuthController } from './auth.controller.js';

/**
 * The whole sign-in, from the HTTP request to the tables, against a real PostgreSQL: the
 * real Google library verifies tokens that a test key signs (so nothing here touches Google),
 * the real repositories write to the test database, and the session that comes out is used
 * on a protected route. Skipped without TEST_DATABASE_URL.
 */
const url = testDatabaseUrl();
const DAY_MS = 24 * 60 * 60 * 1000;
const nowS = () => Math.floor(Date.now() / 1000);
const IP = '203.0.113.77';

/** Everything an answer of the endpoint can hold; each test reads only what it expects. */
interface Answer {
  token: string;
  expiresAt: string;
  user: { id: string; email: string; fullName: string; avatarUrl: string | null; roles: string[] };
  error: { code: string; message: string };
}

describe.skipIf(!url)('POST /api/auth/google end to end (real database)', () => {
  let db: PrismaClient;
  let google: FakeGoogle;
  let sessions: SessionService;
  let baseUrl: string;
  let close: () => Promise<unknown>;

  beforeAll(async () => {
    db = createTestClient(url!);
    google = new FakeGoogle();
    sessions = new SessionService(new SessionRepository(db), new AuthLogRepository(db));
    const login = new GoogleLoginService(
      new GoogleAuthLibraryVerifier(TEST_CLIENT_ID, google.client()),
      new UserRepository(db),
      sessions,
      new AuthLogRepository(db),
    );
    await startServer(login);
  });

  afterAll(async () => {
    await close();
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
    google.keysError = null;
  });

  /** A fresh server per test group would be slow; one is enough, with a limiter per test. */
  let limiterOfTheTest = createRateLimit({ limit: LOGIN_ATTEMPTS_PER_MINUTE });
  async function startServer(login: GoogleLoginService) {
    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      createAuthRouter(new AuthController(login), (req, res, next) =>
        limiterOfTheTest(req, res, next),
      ),
    );
    app.get('/api/private', requireSession(sessions), (_req, res) => {
      res.status(200).json({ email: getAuth(res).email });
    });
    app.use(errorHandler);
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((resolve) => server.close(resolve));
  }

  function freshLimiter() {
    limiterOfTheTest = createRateLimit({
      limit: LOGIN_ATTEMPTS_PER_MINUTE,
      message: (limit) => `Too many sign-in attempts: the limit is ${limit} per minute`,
    });
  }

  async function signIn(credential: unknown, ip = IP) {
    const response = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Chrome en Android',
        'true-client-ip': ip,
      },
      body: JSON.stringify(credential === undefined ? {} : { credential }),
    });
    return {
      response,
      status: response.status,
      body: (await response.json()) as Answer,
    };
  }

  async function privateAs(token: string) {
    const response = await fetch(`${baseUrl}/api/private`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  const logs = () => db.auth_logs.findMany({ orderBy: { id: 'asc' } });
  const counts = async () => ({
    users: await db.users.count(),
    links: await db.oauth_accounts.count(),
    sessions: await db.sessions.count(),
  });
  const written = (value: unknown) =>
    JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));

  describe('a person who signs in for the first time', () => {
    it('gets an account, the base role and a session, and the session works', async () => {
      freshLimiter();
      const token = google.idToken();
      const { status, body, response } = await signIn(token);

      expect(status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(Object.keys(body).sort()).toEqual(['expiresAt', 'token', 'user']);
      expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Math.abs(Date.parse(body.expiresAt) - (Date.now() + 7 * DAY_MS))).toBeLessThan(5000);
      expect(body.user).toEqual({
        id: expect.any(String),
        email: 'ana@example.com',
        fullName: 'Ana Pérez',
        avatarUrl: 'https://lh3.googleusercontent.com/a/ana=s96-c',
        roles: ['usuario'],
      });

      expect(await counts()).toEqual({ users: 1, links: 1, sessions: 1 });
      expect(await privateAs(body.token)).toEqual({
        status: 200,
        body: { email: 'ana@example.com' },
      });
    });

    it('stores only the hash of the session identifier', async () => {
      freshLimiter();
      const { body } = await signIn(google.idToken());

      const [row] = await db.sessions.findMany();
      expect(row?.token_hash).toBe(createHash('sha256').update(body.token).digest('hex'));
      expect(written(row)).not.toContain(body.token);
      expect(written(await db.users.findMany())).not.toContain(body.token);
      expect(written(await logs())).not.toContain(body.token);
    });

    it('writes register and login, with no address, no token and no email', async () => {
      freshLimiter();
      const token = google.idToken();
      const { body } = await signIn(token);

      const entries = await logs();
      expect(entries.map((entry) => [entry.event_type, entry.success])).toEqual([
        ['register', true],
        ['login', true],
      ]);
      for (const entry of entries) {
        expect(entry).toMatchObject({
          user_id: body.user.id,
          ip_address: null,
          user_agent: 'Chrome en Android',
        });
      }
      const text = written(entries);
      expect(text).not.toContain(token);
      expect(text).not.toContain(body.token);
      expect(text).not.toContain('ana@example.com');
    });
  });

  describe('a person who signs in again', () => {
    it('is the same account with a new session, and only login is written', async () => {
      freshLimiter();
      const first = await signIn(google.idToken());
      const again = await signIn(google.idToken());

      expect(again.status).toBe(200);
      expect(again.body.user.id).toBe(first.body.user.id);
      expect(again.body.token).not.toBe(first.body.token);
      expect(await counts()).toEqual({ users: 1, links: 1, sessions: 2 });
      expect((await logs()).map((entry) => entry.event_type)).toEqual([
        'register',
        'login',
        'login',
      ]);
      expect((await privateAs(first.body.token)).status).toBe(200);
      expect((await privateAs(again.body.token)).status).toBe(200);
    });

    it('never keeps more than five open sessions: the sixth closes the oldest', async () => {
      freshLimiter();
      const tokens: string[] = [];
      for (let i = 0; i < 6; i += 1) {
        tokens.push((await signIn(google.idToken())).body.token);
      }

      expect((await privateAs(tokens[0]!)).status).toBe(401);
      expect((await privateAs(tokens[5]!)).status).toBe(200);
      expect(await db.sessions.count({ where: { revoked_at: null } })).toBe(5);
    });
  });

  describe('an account that already exists with the same email', () => {
    it('is linked, keeps its roles, and writes account_linked and login', async () => {
      freshLimiter();
      const userId = await createTestUser(db, { email: 'ana@example.com' });
      const role = await db.roles.findUniqueOrThrow({ where: { name: 'colaborador' } });
      await db.user_roles.create({ data: { user_id: userId, role_id: role.id } });

      const { status, body } = await signIn(google.idToken());

      expect(status).toBe(200);
      expect(body.user).toMatchObject({ id: userId, roles: ['colaborador'] });
      expect((await logs()).map((entry) => entry.event_type)).toEqual(['account_linked', 'login']);
    });

    it('is refused when it is already linked to another Google identity', async () => {
      freshLimiter();
      await signIn(google.idToken({ sub: 'first-identity' }));
      const result = await signIn(google.idToken({ sub: 'second-identity' }));

      expect(result.status).toBe(401);
      expect(result.body.error.code).toBe('INVALID_GOOGLE_TOKEN');
      expect(await counts()).toEqual({ users: 1, links: 1, sessions: 1 });
      const entry = (await logs()).at(-1);
      expect(entry).toMatchObject({ event_type: 'login_failed', reason: 'email_conflict' });
    });
  });

  describe('a token that is refused', () => {
    const refusals: Array<[string, () => string, string]> = [
      [
        'signed with another key',
        () =>
          google.sign(
            {
              iss: 'https://accounts.google.com',
              aud: TEST_CLIENT_ID,
              sub: '1',
              email: 'ana@example.com',
              email_verified: true,
              iat: nowS(),
              exp: nowS() + 3600,
            },
            { key: FakeGoogle.otherKey() },
          ),
        'invalid_token',
      ],
      ['issued for another app', () => google.idToken({ aud: OTHER_CLIENT_ID }), 'invalid_token'],
      ['expired', () => google.idToken({}, nowS() - 7200), 'invalid_token'],
      [
        'with an unverified email',
        () => google.idToken({ email_verified: false }),
        'email_unverified',
      ],
      ['issued 11 minutes ago', () => google.idToken({}, nowS() - 11 * 60), 'token_too_old'],
      ['without an email', () => google.idToken({ email: undefined }), 'invalid_token'],
      ['that is not a token', () => 'not-a-token', 'invalid_token'],
    ];

    it.each(refusals)(
      '%s answers 401, creates nothing and logs why',
      async (_name, make, reason) => {
        freshLimiter();
        const token = make();
        const { status, body } = await signIn(token);

        expect(status).toBe(401);
        expect(body).toEqual({
          error: {
            code: 'INVALID_GOOGLE_TOKEN',
            message: 'The Google sign-in could not be verified',
          },
        });
        expect(await counts()).toEqual({ users: 0, links: 0, sessions: 0 });

        const entries = await logs();
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          user_id: null,
          event_type: 'login_failed',
          success: false,
          reason,
          ip_address: '203.0.113.0',
          user_agent: 'Chrome en Android',
        });
        const text = written(entries);
        expect(text).not.toContain(token);
        expect(text).not.toContain('ana@example.com');
      },
    );

    it('gives the same answer whatever the reason, so it teaches nothing', async () => {
      freshLimiter();
      const answers = new Set<string>();
      for (const [, make] of refusals) {
        answers.add(JSON.stringify((await signIn(make())).body));
      }
      expect(answers.size).toBe(1);
    });
  });

  describe('when something cannot be reached', () => {
    it('answers 503, not 401, when Google cannot be reached, and logs it', async () => {
      freshLimiter();
      google.keysError = new Error('connect ECONNREFUSED 142.250.0.1:443');
      const { status, body } = await signIn(google.idToken());

      expect(status).toBe(503);
      expect(body.error.code).toBe('AUTH_PROVIDER_UNAVAILABLE');
      expect(await counts()).toEqual({ users: 0, links: 0, sessions: 0 });
      expect((await logs())[0]).toMatchObject({
        event_type: 'login_failed',
        reason: 'provider_unavailable',
      });
    });
  });

  describe('a deactivated account', () => {
    it('answers 403, opens no session and logs user_inactive with the person', async () => {
      freshLimiter();
      const first = await signIn(google.idToken());
      await db.users.update({ where: { id: first.body.user.id }, data: { is_active: false } });
      await db.sessions.deleteMany();

      const { status, body } = await signIn(google.idToken());

      expect(status).toBe(403);
      expect(body.error.code).toBe('ACCOUNT_DISABLED');
      expect(await db.sessions.count()).toBe(0);
      expect((await logs()).at(-1)).toMatchObject({
        user_id: first.body.user.id,
        event_type: 'login_failed',
        reason: 'user_inactive',
      });
    });
  });

  describe('the request itself', () => {
    it('answers 400 when the token is missing, and writes nothing', async () => {
      freshLimiter();
      const { status, body } = await signIn(undefined);

      expect(status).toBe(400);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(await logs()).toHaveLength(0);
    });
  });

  describe('the limit of attempts', () => {
    it('answers 429 from the eleventh attempt of one address, and writes no log for it', async () => {
      freshLimiter();
      for (let i = 0; i < LOGIN_ATTEMPTS_PER_MINUTE; i += 1) {
        expect((await signIn('not-a-token')).status).toBe(401);
      }
      const blocked = await signIn(google.idToken());

      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
      expect(Number(blocked.response.headers.get('retry-after'))).toBeGreaterThan(0);
      // Not even a good token gets through, and nothing was written for the blocked attempt.
      expect(await counts()).toEqual({ users: 0, links: 0, sessions: 0 });
      expect(await logs()).toHaveLength(LOGIN_ATTEMPTS_PER_MINUTE);
    });

    it('does not share the allowance between two addresses', async () => {
      freshLimiter();
      for (let i = 0; i < LOGIN_ATTEMPTS_PER_MINUTE + 1; i += 1) {
        await signIn('not-a-token', '198.51.100.1');
      }
      expect((await signIn('not-a-token', '198.51.100.1')).status).toBe(429);

      const other = await signIn(google.idToken(), '198.51.100.2');
      expect(other.status).toBe(200);
    });
  });
});

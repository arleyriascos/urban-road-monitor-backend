import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GoogleAuthLibraryVerifier } from '../auth/google-token-verifier.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { errorHandler } from '../middlewares/error-handler.js';
import { requireSession } from '../middlewares/require-session.js';
import { AccountRepository } from '../repositories/account.repository.js';
import { AuthLogRepository } from '../repositories/auth-log.repository.js';
import { PasswordAccountRepository } from '../repositories/password-account.repository.js';
import { SessionRepository } from '../repositories/session.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import { createAuthRouter } from '../routes/auth.routes.js';
import { AccountService } from '../services/account.service.js';
import { GoogleLoginService } from '../services/google-login.service.js';
import { PasswordAuthService } from '../services/password-auth.service.js';
import { SessionService } from '../services/session.service.js';
import { FakeGoogle, TEST_CLIENT_ID } from '../test/google-test-keys.js';
import { createTestClient, resetDatabase, testDatabaseUrl } from '../test/test-database.js';
import { AuthController } from './auth.controller.js';
import { PasswordAuthController } from './password-auth.controller.js';

/**
 * The accounts with a password, from the HTTP request to the tables, against a real
 * PostgreSQL: sign up, sign in, the profile, the password change that closes the other
 * sessions, and the Google sign-in that takes over an unverified account. Skipped without
 * TEST_DATABASE_URL.
 */
const url = testDatabaseUrl();
const PASSWORD = 'una contraseña larga';
const NEW_PASSWORD = 'otra contraseña distinta';
const pass = (_req: unknown, _res: unknown, next: () => void) => next();

interface Answer {
  token: string;
  user: { id: string; email: string; fullName: string; roles: string[] };
  otherSessionsClosed: number;
  error: { code: string; message: string; details?: { problem?: string } };
}

describe.skipIf(!url)('accounts with a password end to end (real database)', () => {
  let db: PrismaClient;
  let google: FakeGoogle;
  let baseUrl: string;
  let close: () => Promise<unknown>;

  beforeAll(async () => {
    db = createTestClient(url!);
    google = new FakeGoogle();
    const logs = new AuthLogRepository(db);
    const sessions = new SessionService(new SessionRepository(db), logs);
    const passwordService = new PasswordAuthService(
      new PasswordAccountRepository(db),
      sessions,
      logs,
    );
    const googleLogin = new GoogleLoginService(
      new GoogleAuthLibraryVerifier(TEST_CLIENT_ID, google.client()),
      new UserRepository(db),
      sessions,
      logs,
    );
    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      createAuthRouter(
        new AuthController(googleLogin, new AccountService(new AccountRepository(db)), sessions),
        pass,
        requireSession(sessions),
        new PasswordAuthController(passwordService),
        { register: pass, login: pass, loginByEmail: pass, change: pass },
      ),
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

  async function call(path: string, body: unknown, token?: string, method = 'POST') {
    const response = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Chrome en Android',
        'true-client-ip': '203.0.113.77',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Answer };
  }

  const register = (overrides = {}) =>
    call('/auth/register', {
      name: 'Ana Pérez',
      email: 'ana@example.com',
      password: PASSWORD,
      ...overrides,
    });
  const login = (password = PASSWORD, email = 'ana@example.com') =>
    call('/auth/login', { email, password });
  const me = (token: string) => call('/auth/me', undefined, token, 'GET');
  const logRows = async () =>
    (await db.auth_logs.findMany({ orderBy: { id: 'asc' } })).map(
      (row) => `${row.event_type}:${row.success}:${row.reason ?? ''}`,
    );

  it('signs up, and the session of the sign-up works and shows an account with a password and an unverified email', async () => {
    const { status, body } = await register({ email: ' Ana@Example.COM ' });

    expect(status).toBe(201);
    expect(body.user).toMatchObject({ email: 'ana@example.com', roles: ['usuario'] });
    const profile = await me(body.token);
    expect(profile.status).toBe(200);
    expect(profile.body).toMatchObject({
      user: { hasPassword: true, emailVerified: false, roles: ['usuario'] },
    });
    expect(await logRows()).toEqual(['register:true:', 'login:true:']);
  });

  it('never stores the password: only a scrypt hash', async () => {
    await register();
    const stored = await db.password_credentials.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.password_hash).toMatch(/^scrypt\$/);
    expect(
      JSON.stringify(await db.auth_logs.findMany({}), (_k, v: unknown) =>
        typeof v === 'bigint' ? v.toString() : v,
      ),
    ).not.toContain(PASSWORD);
  });

  it('refuses a second account with the same email, in any capitalization', async () => {
    await register();
    const again = await register({ email: 'ANA@example.com' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('EMAIL_TAKEN');
    expect(await db.users.count()).toBe(1);
  });

  it('refuses a weak password and says which rule it breaks', async () => {
    const short = await register({ password: 'corta' });
    const common = await register({ password: 'password123' });
    expect(short.status).toBe(400);
    expect(short.body.error.details?.problem).toBe('too_short');
    expect(common.body.error.details?.problem).toBe('too_common');
    expect(await db.users.count()).toBe(0);
  });

  it('signs in with the right password, in another capitalization of the email', async () => {
    await register();
    const { status, body } = await login(PASSWORD, ' ANA@example.com ');
    expect(status).toBe(200);
    expect((await me(body.token)).status).toBe(200);
  });

  it('answers the very same 401 for a wrong password, an unknown email, a Google-only account and a disabled account', async () => {
    const created = await register();
    await db.users.create({ data: { email: 'google@example.com', full_name: 'G' } });
    await db.users.update({ where: { id: created.body.user.id }, data: { is_active: false } });
    await db.users.create({ data: { email: 'off@example.com', full_name: 'Off' } });

    const answers = [
      await login('wrong wrong wrong'), // disabled account, wrong password
      await login(PASSWORD), // disabled account, right password
      await login(PASSWORD, 'nobody@example.com'),
      await login(PASSWORD, 'google@example.com'),
    ];
    for (const answer of answers) {
      expect(answer.status).toBe(401);
      expect(answer.body.error).toEqual(answers[0]?.body.error);
      expect(answer.body.error.code).toBe('INVALID_CREDENTIALS');
    }
    const reasons = (await logRows()).filter((row) => row.startsWith('login_failed'));
    expect(reasons).toEqual([
      'login_failed:false:wrong_password',
      'login_failed:false:user_inactive',
      'login_failed:false:unknown_account',
      'login_failed:false:unknown_account',
    ]);
  });

  describe('changing the password', () => {
    it('closes the other sessions and keeps the current one, and the new password is the one that works', async () => {
      const first = await register();
      const phone = await login();
      const current = await login();

      const changed = await call(
        '/auth/password',
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        current.body.token,
      );

      expect(changed.status).toBe(200);
      expect(changed.body.otherSessionsClosed).toBe(2);
      expect((await me(first.body.token)).status).toBe(401);
      expect((await me(phone.body.token)).status).toBe(401);
      expect((await me(current.body.token)).status).toBe(200);
      expect((await login(PASSWORD)).status).toBe(401);
      expect((await login(NEW_PASSWORD)).status).toBe(200);
      expect(await logRows()).toContain('password_changed:true:');
    });

    it('answers 403 for a wrong current password and 400 for a weak or repeated new one', async () => {
      const { body } = await register();
      const wrong = await call(
        '/auth/password',
        { currentPassword: 'not mine at all', newPassword: NEW_PASSWORD },
        body.token,
      );
      const weak = await call(
        '/auth/password',
        { currentPassword: PASSWORD, newPassword: 'short' },
        body.token,
      );
      const same = await call(
        '/auth/password',
        { currentPassword: PASSWORD, newPassword: PASSWORD },
        body.token,
      );
      expect(wrong.status).toBe(403);
      expect(wrong.body.error.code).toBe('INVALID_CURRENT_PASSWORD');
      expect(weak.body.error.details?.problem).toBe('too_short');
      expect(same.body.error.details?.problem).toBe('same_as_current');
      expect((await login(PASSWORD)).status).toBe(200);
    });

    it('needs a session', async () => {
      const { status } = await call('/auth/password', {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      });
      expect(status).toBe(401);
    });

    it('answers 409 to an account that signs in with Google only', async () => {
      const token = (await call('/auth/google', { credential: google.idToken() })).body.token;
      const { status, body } = await call(
        '/auth/password',
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        token,
      );
      expect(status).toBe(409);
      expect(body.error.code).toBe('NO_PASSWORD_SET');
      const profile = await me(token);
      expect(profile.body).toMatchObject({ user: { hasPassword: false, emailVerified: true } });
    });
  });

  it('turns an unverified password account into the Google account when that email signs in with Google', async () => {
    const { body } = await register();

    const google1 = await call('/auth/google', { credential: google.idToken() });

    expect(google1.status).toBe(200);
    expect(google1.body.user.id).toBe(body.user.id);
    expect((await login()).status).toBe(401);
    expect((await me(body.token)).status).toBe(401);
    expect(await db.password_credentials.count()).toBe(0);
    const profile = await me(google1.body.token);
    expect(profile.body).toMatchObject({ user: { hasPassword: false, emailVerified: true } });
    expect(await db.users.count()).toBe(1);
  });

  it('keeps the password of an account whose email was verified when it links Google', async () => {
    const { body } = await register();
    await db.users.update({
      where: { id: body.user.id },
      data: { email_verified_at: new Date() },
    });

    const google1 = await call('/auth/google', { credential: google.idToken() });

    expect(google1.status).toBe(200);
    expect(google1.body.user.id).toBe(body.user.id);
    expect((await login()).status).toBe(200);
    expect((await me(body.token)).status).toBe(200);
  });
});

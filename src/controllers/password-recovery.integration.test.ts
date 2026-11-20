import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { startEmailLinkApp } from '../test/email-link-harness.js';
import { createTestClient, resetDatabase, testDatabaseUrl } from '../test/test-database.js';

/**
 * Recovering a forgotten password, from the HTTP request to the tables, against a real
 * PostgreSQL. The link is read from the message the fake mailer was asked to send. Skipped
 * without TEST_DATABASE_URL.
 */
const url = testDatabaseUrl();
const PASSWORD = 'una contraseña larga';
const NEW_PASSWORD = 'otra contraseña distinta';

describe.skipIf(!url)('recovering a password end to end (real database)', () => {
  let db: PrismaClient;
  let app: Awaited<ReturnType<typeof startEmailLinkApp>>;

  beforeAll(async () => {
    db = createTestClient(url!);
    app = await startEmailLinkApp(db);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase(db);
    app.sent.length = 0;
  });

  const register = () =>
    app.call('/auth/register', { name: 'Ana Pérez', email: 'ana@example.com', password: PASSWORD });
  const login = (password: string) =>
    app.call('/auth/login', { email: 'ana@example.com', password });
  const forgot = (email = 'ana@example.com') => app.call('/auth/forgot-password', { email });
  const reset = (token: string, newPassword = NEW_PASSWORD) =>
    app.call('/auth/reset-password', { token, newPassword });

  it('chooses a new password with the link: the old one stops working, the new one works', async () => {
    await register();
    expect((await forgot()).status).toBe(200);
    expect(app.sent).toHaveLength(1);
    expect(app.sent[0]!.text).toContain('https://site.example.com/restablecer#token=');

    const answer = await reset(app.lastToken());

    expect(answer).toMatchObject({ status: 200, body: { reset: true } });
    expect((await login(PASSWORD)).status).toBe(401);
    expect((await login(NEW_PASSWORD)).status).toBe(200);
  });

  it('closes every session of the person and verifies the email', async () => {
    const { body: first } = await register();
    const { body: second } = await login(PASSWORD);
    await forgot();

    await reset(app.lastToken());

    expect((await app.call('/auth/me', undefined, first.token, 'GET')).status).toBe(401);
    expect((await app.call('/auth/me', undefined, second.token, 'GET')).status).toBe(401);
    const user = await db.users.findUniqueOrThrow({ where: { email: 'ana@example.com' } });
    expect(user.email_verified_at).not.toBeNull();
  });

  it('opens no session: the person has to sign in', async () => {
    await register();
    await forgot();
    const answer = await reset(app.lastToken());
    expect(answer.body.token).toBeUndefined();
  });

  it('works only once', async () => {
    await register();
    await forgot();
    const token = app.lastToken();

    expect((await reset(token)).status).toBe(200);
    const again = await reset(token, 'una tercera contraseña larga');

    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_TOKEN');
    expect((await login(NEW_PASSWORD)).status).toBe(200);
  });

  it('keeps the link alive when the new password is refused, so the person can try again', async () => {
    await register();
    await forgot();
    const token = app.lastToken();

    const weak = await reset(token, 'corta');
    expect(weak.status).toBe(400);
    expect(weak.body.error).toMatchObject({
      code: 'INVALID_PASSWORD',
      details: { problem: 'too_short' },
    });
    expect((await reset(token, 'ana@example.com')).body.error.details?.problem).toBe(
      'same_as_email',
    );

    expect((await reset(token)).status).toBe(200);
  });

  it('a new request cancels the previous link', async () => {
    await register();
    await forgot();
    const first = app.lastToken();
    await forgot();

    expect((await reset(first)).status).toBe(400);
    expect((await reset(app.lastToken())).status).toBe(200);
  });

  it('answers the same, and sends nothing, for an email with no account and for a Google-only account', async () => {
    await db.users.create({ data: { email: 'google@example.com', full_name: 'G' } });
    await register();

    const known = await forgot('ana@example.com');
    const unknown = await forgot('nadie@example.com');
    const googleOnly = await forgot('google@example.com');

    expect(known.status).toBe(200);
    expect(unknown).toEqual(known);
    expect(googleOnly).toEqual(known);
    expect(app.sent).toHaveLength(1);
    expect(app.sent[0]!.to).toBe('ana@example.com');
  });

  it('does not send anything to a deactivated account', async () => {
    await register();
    await db.users.updateMany({ data: { is_active: false } });
    expect((await forgot()).status).toBe(200);
    expect(app.sent).toHaveLength(0);
  });

  it('refuses an expired, an invented and a malformed token with the same answer', async () => {
    await register();
    await forgot();
    const real = app.lastToken();
    await db.email_tokens.updateMany({ data: { expires_at: new Date('2020-01-01') } });

    for (const token of [real, 'A'.repeat(43), 'nope']) {
      const answer = await reset(token);
      expect(answer.status).toBe(400);
      expect(answer.body.error).toEqual({
        code: 'INVALID_TOKEN',
        message: 'The link is not valid or has expired',
      });
    }
  });

  it('logs the reset without the token or the password', async () => {
    await register();
    await forgot();
    const token = app.lastToken();
    await reset(token);

    const logs = JSON.stringify(await db.auth_logs.findMany(), (_k, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(logs).toContain('password_reset');
    expect(logs).not.toContain(token);
    expect(logs).not.toContain(NEW_PASSWORD);
  });

  it('a verification link does not work as a recovery link', async () => {
    const { body: session } = await register();
    await app.call('/auth/verify-email/send', {}, session.token);

    const answer = await reset(app.lastToken());

    expect(answer.status).toBe(400);
    expect(answer.body.error.code).toBe('INVALID_TOKEN');
  });

  it('answers 503 for any email when the e-mail service is not configured', async () => {
    const off = await startEmailLinkApp(db, false);
    try {
      expect((await off.call('/auth/forgot-password', { email: 'ana@example.com' })).status).toBe(
        503,
      );
      expect((await off.call('/auth/forgot-password', { email: 'nadie@example.com' })).status).toBe(
        503,
      );
    } finally {
      await off.close();
    }
  });
});

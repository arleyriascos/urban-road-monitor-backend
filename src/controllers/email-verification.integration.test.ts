import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashEmailToken } from '../auth/email-token.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { startEmailLinkApp } from '../test/email-link-harness.js';
import { createTestClient, resetDatabase, testDatabaseUrl } from '../test/test-database.js';

/**
 * Verifying the email, from the HTTP request to the tables, against a real PostgreSQL. The link
 * is read from the message the fake mailer was asked to send. Skipped without TEST_DATABASE_URL.
 */
const url = testDatabaseUrl();
const PASSWORD = 'una contraseña larga';

describe.skipIf(!url)('verifying the email end to end (real database)', () => {
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
  const me = async (token: string) =>
    (await app.call('/auth/me', undefined, token, 'GET')).body as unknown as {
      user: { emailVerified: boolean };
    };

  it('sends the link, and opening it verifies the email', async () => {
    const { body: session } = await register();
    expect((await me(session.token)).user.emailVerified).toBe(false);

    const sent = await app.call('/auth/verify-email/send', {}, session.token);

    expect(sent).toMatchObject({ status: 200, body: { sent: true } });
    expect(app.sent).toHaveLength(1);
    expect(app.sent[0]!.to).toBe('ana@example.com');
    expect(app.sent[0]!.text).toContain('https://site.example.com/verificar#token=');

    const used = await app.call('/auth/verify-email', { token: app.lastToken() });
    expect(used).toMatchObject({ status: 200, body: { verified: true } });
    expect((await me(session.token)).user.emailVerified).toBe(true);
  });

  it('keeps only the hash of the token and logs the verification without it', async () => {
    const { body: session } = await register();
    await app.call('/auth/verify-email/send', {}, session.token);
    const token = app.lastToken();

    const rows = await db.email_tokens.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).toBe(hashEmailToken(token));
    await app.call('/auth/verify-email', { token });

    const logs = JSON.stringify(await db.auth_logs.findMany(), (_k, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(logs).not.toContain(token);
    expect(logs).toContain('email_verified');
  });

  it('works only once', async () => {
    const { body: session } = await register();
    await app.call('/auth/verify-email/send', {}, session.token);
    const token = app.lastToken();

    expect((await app.call('/auth/verify-email', { token })).status).toBe(200);
    const again = await app.call('/auth/verify-email', { token });

    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_TOKEN');
  });

  it('a new link replaces the old one', async () => {
    const { body: session } = await register();
    await app.call('/auth/verify-email/send', {}, session.token);
    const first = app.lastToken();
    await app.call('/auth/verify-email/send', {}, session.token);

    expect((await app.call('/auth/verify-email', { token: first })).status).toBe(400);
    expect((await app.call('/auth/verify-email', { token: app.lastToken() })).status).toBe(200);
  });

  it('refuses a token that expired, an invented one and a malformed one with the same answer', async () => {
    const { body: session } = await register();
    await app.call('/auth/verify-email/send', {}, session.token);
    await db.email_tokens.updateMany({ data: { expires_at: new Date('2020-01-01') } });

    const answers = await Promise.all([
      app.call('/auth/verify-email', { token: app.lastToken() }),
      app.call('/auth/verify-email', { token: 'A'.repeat(43) }),
      app.call('/auth/verify-email', { token: 'nope' }),
    ]);

    for (const answer of answers) {
      expect(answer.status).toBe(400);
      expect(answer.body.error).toEqual({
        code: 'INVALID_TOKEN',
        message: 'The link is not valid or has expired',
      });
    }
  });

  it('does not send a link to an account that is already verified', async () => {
    const { body: session } = await register();
    await app.call('/auth/verify-email/send', {}, session.token);
    await app.call('/auth/verify-email', { token: app.lastToken() });

    const again = await app.call('/auth/verify-email/send', {}, session.token);

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_VERIFIED');
    expect(app.sent).toHaveLength(1);
  });

  it('needs a session to ask for the link', async () => {
    expect((await app.call('/auth/verify-email/send', {})).status).toBe(401);
    expect(app.sent).toHaveLength(0);
  });

  it('answers 503 and stores no token when the e-mail service is not configured', async () => {
    const off = await startEmailLinkApp(db, false);
    try {
      const { body: session } = await off.call('/auth/register', {
        name: 'Ana',
        email: 'ana@example.com',
        password: PASSWORD,
      });
      const answer = await off.call('/auth/verify-email/send', {}, session.token);
      expect(answer.status).toBe(503);
      expect(answer.body.error.code).toBe('MAIL_NOT_CONFIGURED');
      expect(await db.email_tokens.count()).toBe(0);
    } finally {
      await off.close();
    }
  });
});

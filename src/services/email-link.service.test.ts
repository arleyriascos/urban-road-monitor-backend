import { describe, expect, it, vi } from 'vitest';
import { hashEmailToken } from '../auth/email-token.js';
import { AppError } from '../errors/app-error.js';
import type { Mailer, MailMessage } from '../mail/mailer.js';
import type { UsableEmailToken } from '../repositories/email-token.repository.js';
import { EmailLinkService } from './email-link.service.js';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const TOKEN = 'T'.repeat(43);
const USER = '5f0b3c2e-0000-4000-8000-000000000001';
const found: UsableEmailToken = {
  tokenId: 'token-1',
  userId: USER,
  email: 'ana@example.com',
  isActive: true,
  hasPassword: true,
  emailVerified: false,
};

function setup(
  overrides: {
    state?: object | null;
    found?: UsableEmailToken | null;
    used?: boolean;
    mailError?: Error;
  } = {},
) {
  const sent: MailMessage[] = [];
  const mailer: Mailer = {
    send: vi.fn(async (message: MailMessage) => {
      if (overrides.mailError) throw overrides.mailError;
      sent.push(message);
    }),
  };
  const tokens = {
    issue: vi.fn(async () => undefined),
    findUsable: vi.fn(async () => (overrides.found === undefined ? found : overrides.found)),
    accountState: vi.fn(async () =>
      overrides.state === undefined
        ? { email: 'ana@example.com', isActive: true, emailVerified: false, hasPassword: true }
        : overrides.state,
    ),
    verifyEmail: vi.fn(async () => overrides.used ?? true),
  };
  const logs = { record: vi.fn(async () => undefined) };
  const service = new EmailLinkService(
    tokens as never,
    { mailer, appUrl: 'https://site.example.com' },
    logs,
    () => NOW,
    () => TOKEN,
  );
  return { service, tokens, logs, sent, mailer };
}

describe('EmailLinkService verification', () => {
  describe('sendVerification', () => {
    it('stores the hash of a token that lasts 24 hours and e-mails the link with the token after the #', async () => {
      const { service, tokens, sent } = setup();

      await service.sendVerification(USER);

      expect(tokens.issue).toHaveBeenCalledWith({
        userId: USER,
        purpose: 'verify_email',
        tokenHash: hashEmailToken(TOKEN),
        expiresAt: new Date('2026-11-21T12:00:00.000Z'),
        now: NOW,
      });
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe('ana@example.com');
      expect(sent[0]!.text).toContain(`https://site.example.com/verificar#token=${TOKEN}`);
    });

    it('answers 503 and sends nothing when the e-mail service is not configured', async () => {
      const service = new EmailLinkService({} as never, null);
      expect(service.isConfigured).toBe(false);
      await expect(service.sendVerification(USER)).rejects.toMatchObject({
        statusCode: 503,
        code: 'MAIL_NOT_CONFIGURED',
      });
    });

    it('answers 409 when the email is already verified, and sends nothing', async () => {
      const { service, tokens, sent } = setup({
        state: { email: 'a@example.com', isActive: true, emailVerified: true, hasPassword: true },
      });
      await expect(service.sendVerification(USER)).rejects.toMatchObject({
        statusCode: 409,
        code: 'ALREADY_VERIFIED',
      });
      expect(tokens.issue).not.toHaveBeenCalled();
      expect(sent).toHaveLength(0);
    });

    it('answers 404 for an account that is gone or inactive', async () => {
      for (const state of [
        null,
        { email: 'a@example.com', isActive: false, emailVerified: false, hasPassword: true },
      ]) {
        const { service } = setup({ state });
        await expect(service.sendVerification(USER)).rejects.toMatchObject({ statusCode: 404 });
      }
    });

    it('answers 502 without leaking details when the message cannot be sent', async () => {
      const { service } = setup({ mailError: new Error('Brevo refused the message (HTTP 400)') });
      const error = await service.sendVerification(USER).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ statusCode: 502, code: 'MAIL_FAILED' });
      expect((error as AppError).message).not.toContain('Brevo');
    });

    it('answers 503 when the database fails', async () => {
      const { service, tokens } = setup();
      tokens.accountState.mockRejectedValue(new Error('down'));
      await expect(service.sendVerification(USER)).rejects.toMatchObject({
        statusCode: 503,
        code: 'DATABASE_UNAVAILABLE',
      });
    });
  });

  describe('verifyEmail', () => {
    it('verifies the email of the account of a good token and logs it', async () => {
      const { service, tokens, logs } = setup();

      await service.verifyEmail(TOKEN, { userAgent: 'agent' });

      expect(tokens.findUsable).toHaveBeenCalledWith('verify_email', hashEmailToken(TOKEN), NOW);
      expect(tokens.verifyEmail).toHaveBeenCalledWith({
        tokenId: 'token-1',
        userId: USER,
        now: NOW,
      });
      expect(logs.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'email_verified', success: true, userId: USER }),
      );
    });

    it.each([
      ['a text that cannot be a token', 'short', {}],
      ['an unknown, used or expired token', TOKEN, { found: null }],
      ['an inactive account', TOKEN, { found: { ...found, isActive: false } }],
      ['a token somebody used first', TOKEN, { used: false }],
    ])(
      'answers the same 400 for %s, and logs the failure with a code',
      async (_name, token, extra) => {
        const { service, logs } = setup(extra);

        const error = await service
          .verifyEmail(token, { ip: '203.0.113.7' })
          .catch((e: unknown) => e);

        expect(error).toMatchObject({
          statusCode: 400,
          code: 'INVALID_TOKEN',
          message: 'The link is not valid or has expired',
        });
        expect(logs.record).toHaveBeenCalledWith(
          expect.objectContaining({
            eventType: 'email_verified',
            success: false,
            reason: 'invalid_token',
          }),
        );
      },
    );

    it('does not ask the database about a text that cannot be a token', async () => {
      const { service, tokens } = setup();
      await service.verifyEmail('nope').catch(() => undefined);
      expect(tokens.findUsable).not.toHaveBeenCalled();
    });

    it('does not stop when the audit log cannot be written', async () => {
      const { service, logs } = setup();
      logs.record.mockRejectedValue(new Error('log down'));
      await expect(service.verifyEmail(TOKEN)).resolves.toBeUndefined();
    });

    it('answers 503 when the database fails', async () => {
      const { service, tokens } = setup();
      tokens.findUsable.mockRejectedValue(new Error('down'));
      await expect(service.verifyEmail(TOKEN)).rejects.toMatchObject({ statusCode: 503 });
    });
  });
});

describe('EmailLinkService password recovery', () => {
  const record = {
    user: {
      id: USER,
      email: 'ana@example.com',
      fullName: 'Ana',
      avatarUrl: null,
      roles: ['usuario'],
    },
    passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA',
    isActive: true,
  };

  function setupReset(
    overrides: {
      record?: typeof record | null;
      found?: UsableEmailToken | null;
      closed?: number | null;
      mailError?: Error;
    } = {},
  ) {
    const base = setup({ found: overrides.found === undefined ? found : overrides.found });
    const resetPassword = vi.fn(async () =>
      overrides.closed === undefined ? 2 : overrides.closed,
    );
    const passwords = {
      findForLogin: vi.fn(async () => (overrides.record === undefined ? record : overrides.record)),
    };
    const mailer: Mailer = {
      send: vi.fn(async (message: MailMessage) => {
        if (overrides.mailError) throw overrides.mailError;
        base.sent.push(message);
      }),
    };
    const service = new EmailLinkService(
      { ...base.tokens, resetPassword } as never,
      { mailer, appUrl: 'https://site.example.com' },
      base.logs,
      () => NOW,
      () => TOKEN,
      passwords,
    );
    return { ...base, service, resetPassword, passwords };
  }

  describe('requestPasswordReset', () => {
    it('stores a token that lasts 1 hour and e-mails the link of the recovery page', async () => {
      const { service, tokens, sent } = setupReset();

      await service.requestPasswordReset(' Ana@Example.COM ');

      expect(tokens.issue).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER,
          purpose: 'reset_password',
          tokenHash: hashEmailToken(TOKEN),
          expiresAt: new Date('2026-11-20T13:00:00.000Z'),
        }),
      );
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe('ana@example.com');
      expect(sent[0]!.text).toContain(`https://site.example.com/restablecer#token=${TOKEN}`);
    });

    it('looks the account up with the email trimmed and in lowercase', async () => {
      const { service, passwords } = setupReset();
      await service.requestPasswordReset('  ANA@Example.com ');
      expect(passwords.findForLogin).toHaveBeenCalledWith('ana@example.com');
    });

    it.each([
      ['no account (or one that only has Google)', { record: null }],
      ['an inactive account', { record: { ...record, isActive: false } }],
    ])('does nothing and says nothing for %s', async (_name, extra) => {
      const { service, tokens, sent } = setupReset(extra);
      await expect(service.requestPasswordReset('ana@example.com')).resolves.toBeUndefined();
      expect(tokens.issue).not.toHaveBeenCalled();
      expect(sent).toHaveLength(0);
    });

    it('does not wait for the e-mail service, and hides its failure', async () => {
      const { service } = setupReset({ mailError: new Error('Brevo could not be reached') });
      await expect(service.requestPasswordReset('ana@example.com')).resolves.toBeUndefined();
    });

    it('answers 503 when the e-mail service is not configured, for any email', async () => {
      const service = new EmailLinkService({} as never, null);
      await expect(service.requestPasswordReset('whoever@example.com')).rejects.toMatchObject({
        statusCode: 503,
        code: 'MAIL_NOT_CONFIGURED',
      });
    });
  });

  describe('resetPassword', () => {
    it('replaces the password with a scrypt hash, never the text, and logs it', async () => {
      const { service, resetPassword, logs } = setupReset();

      const closed = await service.resetPassword(TOKEN, 'una contraseña nueva larga', {
        userAgent: 'agent',
      });

      expect(closed).toBe(2);
      expect(resetPassword).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenId: 'token-1',
          userId: USER,
          now: NOW,
          passwordHash: expect.stringMatching(/^scrypt\$/),
        }),
      );
      expect(JSON.stringify(resetPassword.mock.calls)).not.toContain('una contraseña nueva larga');
      expect(logs.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'password_reset', success: true, userId: USER }),
      );
    });

    it.each([
      ['too short', 'corta', 'too_short'],
      ['the same as the email', 'ana@example.com', 'same_as_email'],
      ['too common', 'password123', 'too_common'],
    ])(
      'refuses a password that is %s and does not spend the link',
      async (_name, password, problem) => {
        const { service, resetPassword } = setupReset();

        const error = await service.resetPassword(TOKEN, password).catch((e: unknown) => e);

        expect(error).toMatchObject({
          statusCode: 400,
          code: 'INVALID_PASSWORD',
          details: { problem },
        });
        expect(resetPassword).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['a text that cannot be a token', 'short', {}],
      ['an unknown, used or expired token', TOKEN, { found: null }],
      ['an inactive account', TOKEN, { found: { ...found, isActive: false } }],
      ['an account with no password', TOKEN, { found: { ...found, hasPassword: false } }],
      ['a token somebody used first', TOKEN, { closed: null }],
    ])('answers the same 400 for %s', async (_name, token, extra) => {
      const { service, logs } = setupReset(extra);

      const error = await service
        .resetPassword(token, 'una contraseña nueva larga', { ip: '203.0.113.7' })
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ statusCode: 400, code: 'INVALID_TOKEN' });
      expect(logs.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'password_reset',
          success: false,
          reason: 'invalid_token',
        }),
      );
    });

    it('answers 503 when the database fails while replacing the password', async () => {
      const { service, resetPassword } = setupReset();
      resetPassword.mockRejectedValue(new Error('down'));
      await expect(
        service.resetPassword(TOKEN, 'una contraseña nueva larga'),
      ).rejects.toMatchObject({
        statusCode: 503,
      });
    });
  });
});

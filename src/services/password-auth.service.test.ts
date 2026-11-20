import { describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../auth/password-hash.js';
import type { AuthLogEntry } from '../repositories/auth-log.repository.js';
import type { PasswordLoginRecord } from '../repositories/password-account.repository.js';
import type { AuthUser } from '../repositories/user.repository.js';
import { PasswordAuthService, normalizeEmail } from './password-auth.service.js';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const USER: AuthUser = {
  id: 'user-1',
  email: 'ana@example.com',
  fullName: 'Ana Pérez',
  avatarUrl: null,
  roles: ['usuario'],
};
const PASSWORD = 'una contraseña larga';
const REQUEST = { userAgent: 'test-agent', ip: '203.0.113.9' };

async function setup(overrides: { record?: Partial<PasswordLoginRecord> | null } = {}) {
  const record: PasswordLoginRecord | null =
    overrides.record === null
      ? null
      : {
          user: USER,
          passwordHash: await hashPassword(PASSWORD),
          isActive: true,
          ...overrides.record,
        };
  const accounts = {
    register: vi.fn(async () => ({ kind: 'created' as const, user: USER })),
    findForLogin: vi.fn(async () => record),
    touchLogin: vi.fn(async () => undefined),
    findHash: vi.fn(async () => record?.passwordHash ?? null),
    changePassword: vi.fn(async () => 2 as number | null),
  };
  const sessions = {
    open: vi.fn(async () => ({
      token: 'token-1',
      sessionId: 's-1',
      expiresAt: new Date('2026-11-17'),
    })),
  };
  const logs = {
    record: vi.fn(async (entry: AuthLogEntry) => {
      void entry;
    }),
  };
  const service = new PasswordAuthService(accounts, sessions, logs, () => NOW);
  return { service, accounts, sessions, logs };
}

const events = (logs: { record: ReturnType<typeof vi.fn> }) =>
  logs.record.mock.calls.map(
    ([entry]) => `${entry.eventType}:${entry.success}:${entry.reason ?? ''}`,
  );

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Ana@Example.COM ')).toBe('ana@example.com');
  });
});

describe('PasswordAuthService.register', () => {
  it('stores a hash (never the password), opens a session and logs register and login', async () => {
    const { service, accounts, sessions, logs } = await setup();

    const result = await service.register(
      { name: '  Ana   Pérez ', email: ' Ana@Example.com ', password: PASSWORD },
      REQUEST,
    );

    expect(result).toEqual({ token: 'token-1', expiresAt: new Date('2026-11-17'), user: USER });
    const [stored] = accounts.register.mock.calls[0] as unknown as [
      { email: string; fullName: string; passwordHash: string; now: Date },
    ];
    expect(stored).toMatchObject({ email: 'ana@example.com', fullName: 'Ana Pérez', now: NOW });
    expect(stored.passwordHash).toMatch(/^scrypt\$/);
    expect(stored.passwordHash).not.toContain(PASSWORD);
    expect(sessions.open).toHaveBeenCalledWith('user-1', 'test-agent');
    expect(events(logs)).toEqual(['register:true:', 'login:true:']);
  });

  it('refuses a bad password with the problem, before touching the database', async () => {
    const { service, accounts } = await setup();
    await expect(
      service.register({ name: 'Ana', email: 'ana@example.com', password: 'short' }, REQUEST),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_PASSWORD',
      details: { problem: 'too_short' },
    });
    await expect(
      service.register(
        { name: 'Ana', email: 'ana@example.com', password: 'Ana@Example.com' },
        REQUEST,
      ),
    ).rejects.toMatchObject({ details: { problem: 'same_as_email' } });
    expect(accounts.register).not.toHaveBeenCalled();
  });

  it('refuses an empty name', async () => {
    const { service } = await setup();
    await expect(
      service.register({ name: ' \t ', email: 'ana@example.com', password: PASSWORD }, REQUEST),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_REQUEST' });
  });

  it('answers 409 when the email is taken, and opens no session', async () => {
    const { service, accounts, sessions } = await setup();
    accounts.register.mockResolvedValueOnce({ kind: 'email_taken' } as never);
    await expect(
      service.register({ name: 'Ana', email: 'ana@example.com', password: PASSWORD }, REQUEST),
    ).rejects.toMatchObject({ statusCode: 409, code: 'EMAIL_TAKEN' });
    expect(sessions.open).not.toHaveBeenCalled();
  });

  it('answers 503 when the database fails', async () => {
    const { service, accounts } = await setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    accounts.register.mockRejectedValueOnce(new Error('down'));
    await expect(
      service.register({ name: 'Ana', email: 'ana@example.com', password: PASSWORD }, REQUEST),
    ).rejects.toMatchObject({ statusCode: 503, code: 'DATABASE_UNAVAILABLE' });
  });

  it('still registers when the log cannot be written', async () => {
    const { service, logs } = await setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logs.record.mockRejectedValue(new Error('log down'));
    await expect(
      service.register({ name: 'Ana', email: 'ana@example.com', password: PASSWORD }, REQUEST),
    ).resolves.toMatchObject({ token: 'token-1' });
  });
});

describe('PasswordAuthService.login', () => {
  it('opens a session for the right password and logs the login', async () => {
    const { service, accounts, sessions, logs } = await setup();
    const result = await service.login({ email: ' ANA@example.com', password: PASSWORD }, REQUEST);
    expect(result).toMatchObject({ token: 'token-1', user: USER });
    expect(accounts.findForLogin).toHaveBeenCalledWith('ana@example.com');
    expect(accounts.touchLogin).toHaveBeenCalledWith('user-1', NOW);
    expect(sessions.open).toHaveBeenCalledWith('user-1', 'test-agent');
    expect(events(logs)).toEqual(['login:true:']);
  });

  it('answers the same 401 for an unknown email, a wrong password and a deactivated account', async () => {
    const answers = [];
    for (const [setupArg, password, reason] of [
      [{ record: null }, PASSWORD, 'unknown_account'],
      [{}, 'not the password', 'wrong_password'],
      [{ record: { isActive: false } }, PASSWORD, 'user_inactive'],
    ] as const) {
      const { service, sessions, logs } = await setup(setupArg);
      const error = await service
        .login({ email: 'ana@example.com', password }, REQUEST)
        .catch((e: unknown) => e);
      answers.push(error);
      expect(sessions.open).not.toHaveBeenCalled();
      expect(events(logs)).toEqual([`login_failed:false:${reason}`]);
      expect(logs.record.mock.calls[0]?.[0]).toMatchObject({ ip: '203.0.113.9' });
    }
    for (const error of answers) {
      expect(error).toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
    }
    const messages = new Set(answers.map((e) => (e as Error).message));
    expect(messages.size).toBe(1);
  });

  it('checks the password before the state of the account: a deactivated account with a wrong password is a wrong password', async () => {
    const { service, logs } = await setup({ record: { isActive: false } });
    await expect(
      service.login({ email: 'ana@example.com', password: 'nope nope nope' }, REQUEST),
    ).rejects.toThrow();
    expect(events(logs)).toEqual(['login_failed:false:wrong_password']);
  });

  it('answers 503 when the database fails', async () => {
    const { service, accounts } = await setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    accounts.findForLogin.mockRejectedValueOnce(new Error('down'));
    await expect(
      service.login({ email: 'ana@example.com', password: PASSWORD }, REQUEST),
    ).rejects.toMatchObject({
      statusCode: 503,
    });
  });
});

describe('PasswordAuthService.changePassword', () => {
  const session = { userId: 'user-1', sessionId: 's-1', email: 'ana@example.com' };
  const NEW = 'otra contraseña distinta';

  it('replaces the hash, keeps the current session and answers how many it closed', async () => {
    const { service, accounts, logs } = await setup();
    const closed = await service.changePassword(
      session,
      { currentPassword: PASSWORD, newPassword: NEW },
      REQUEST,
    );
    expect(closed).toBe(2);
    expect(accounts.changePassword).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', keepSessionId: 's-1', now: NOW }),
    );
    const [{ passwordHash }] = accounts.changePassword.mock.calls[0] as unknown as [
      { passwordHash: string },
    ];
    expect(passwordHash).toMatch(/^scrypt\$/);
    expect(events(logs)).toEqual(['password_changed:true:']);
  });

  it('answers 403 (not 401) when the current password is wrong, and changes nothing', async () => {
    const { service, accounts, logs } = await setup();
    await expect(
      service.changePassword(
        session,
        { currentPassword: 'wrong wrong wrong', newPassword: NEW },
        REQUEST,
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: 'INVALID_CURRENT_PASSWORD' });
    expect(accounts.changePassword).not.toHaveBeenCalled();
    expect(events(logs)).toEqual(['password_changed:false:wrong_password']);
  });

  it('answers 409 for an account that has no password (Google only)', async () => {
    const { service } = await setup({ record: null });
    await expect(
      service.changePassword(session, { currentPassword: PASSWORD, newPassword: NEW }, REQUEST),
    ).rejects.toMatchObject({ statusCode: 409, code: 'NO_PASSWORD_SET' });
  });

  it('refuses a new password that breaks the rules or repeats the current one', async () => {
    const { service, accounts } = await setup();
    await expect(
      service.changePassword(session, { currentPassword: PASSWORD, newPassword: 'short' }, REQUEST),
    ).rejects.toMatchObject({ statusCode: 400, details: { problem: 'too_short' } });
    await expect(
      service.changePassword(
        session,
        { currentPassword: PASSWORD, newPassword: PASSWORD },
        REQUEST,
      ),
    ).rejects.toMatchObject({ statusCode: 400, details: { problem: 'same_as_current' } });
    expect(accounts.changePassword).not.toHaveBeenCalled();
  });

  it('answers 409 if the password disappeared between the check and the change', async () => {
    const { service, accounts } = await setup();
    accounts.changePassword.mockResolvedValueOnce(null);
    await expect(
      service.changePassword(session, { currentPassword: PASSWORD, newPassword: NEW }, REQUEST),
    ).rejects.toMatchObject({ statusCode: 409, code: 'NO_PASSWORD_SET' });
  });
});

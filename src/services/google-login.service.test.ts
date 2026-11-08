import { describe, expect, it, vi } from 'vitest';
import {
  GoogleUnavailableError,
  InvalidGoogleTokenError,
  type GoogleTokenClaims,
} from '../auth/google-token-verifier.js';
import { AppError } from '../errors/app-error.js';
import type { AuthLogEntry } from '../repositories/auth-log.repository.js';
import type { AuthUser, GoogleSignInOutcome } from '../repositories/user.repository.js';
import { GoogleLoginService } from './google-login.service.js';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const nowS = Math.floor(NOW.getTime() / 1000);
const CREDENTIAL = 'header.payload.signature-of-a-google-token';
const REQUEST = { userAgent: 'Chrome en Android', ip: '203.0.113.77' };
const EXPIRES = new Date('2026-11-17T12:00:00.000Z');

const USER: AuthUser = {
  id: '5f0b3c2e-0000-4000-8000-000000000001',
  email: 'ana@example.com',
  fullName: 'Ana Pérez',
  avatarUrl: 'https://lh3.googleusercontent.com/a/ana=s96-c',
  roles: ['usuario'],
};

const GOOD_CLAIMS: GoogleTokenClaims = {
  subject: '110169484474386276334',
  email: 'Ana@Example.com',
  emailVerified: true,
  name: 'Ana Pérez',
  picture: USER.avatarUrl ?? undefined,
  issuedAt: nowS - 5,
};

const KNOWN_PERSON: GoogleSignInOutcome = {
  kind: 'signed_in',
  user: USER,
  created: false,
  linked: false,
};

function setup(
  options: {
    claims?: GoogleTokenClaims;
    verifyError?: unknown;
    outcome?: GoogleSignInOutcome;
    usersError?: unknown;
    sessionError?: unknown;
    logError?: unknown;
    configured?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const records: AuthLogEntry[] = [];

  const verify = vi.fn(async () => {
    calls.push('verify');
    if (options.verifyError) {
      throw options.verifyError;
    }
    return options.claims ?? GOOD_CLAIMS;
  });
  const signInWithGoogle = vi.fn(async () => {
    calls.push('users');
    if (options.usersError) {
      throw options.usersError;
    }
    return options.outcome ?? KNOWN_PERSON;
  });
  const open = vi.fn(async () => {
    calls.push('session');
    if (options.sessionError) {
      throw options.sessionError;
    }
    return { token: 'T'.repeat(43), sessionId: 'session-1', expiresAt: EXPIRES };
  });
  const record = vi.fn(async (entry: AuthLogEntry) => {
    calls.push(`log:${entry.eventType}`);
    if (options.logError) {
      throw options.logError;
    }
    records.push(entry);
  });

  const service = new GoogleLoginService(
    options.configured === false ? null : { verify },
    { signInWithGoogle },
    { open },
    { record },
    () => NOW,
  );
  return { service, calls, records, verify, signInWithGoogle, open, record };
}

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe('GoogleLoginService.login, when it goes well', () => {
  it('gives back the session and the person, and opens the session for that person', async () => {
    const { service, open } = setup();
    const result = await service.login(CREDENTIAL, REQUEST);

    expect(result).toEqual({ token: 'T'.repeat(43), expiresAt: EXPIRES, user: USER });
    expect(open).toHaveBeenCalledWith(USER.id, 'Chrome en Android');
  });

  it('gives the repository the checked identity, with the email in lowercase, and the time', async () => {
    const { service, signInWithGoogle } = setup();
    await service.login(CREDENTIAL, REQUEST);

    expect(signInWithGoogle).toHaveBeenCalledWith({
      subject: '110169484474386276334',
      email: 'ana@example.com',
      name: 'Ana Pérez',
      picture: USER.avatarUrl,
      now: NOW,
    });
  });

  it('writes one login event for a person who already had an account', async () => {
    const { service, calls, records } = setup();
    await service.login(CREDENTIAL, REQUEST);

    expect(calls).toEqual(['verify', 'users', 'session', 'log:login']);
    expect(records).toEqual([
      {
        userId: USER.id,
        eventType: 'login',
        success: true,
        userAgent: 'Chrome en Android',
        now: NOW,
      },
    ]);
  });

  it('writes register before the session and login after it, for a new account', async () => {
    const { service, calls } = setup({
      outcome: { kind: 'signed_in', user: USER, created: true, linked: false },
    });
    await service.login(CREDENTIAL, REQUEST);

    expect(calls).toEqual(['verify', 'users', 'log:register', 'session', 'log:login']);
  });

  it('writes account_linked before the session and login after it, for a linked account', async () => {
    const { service, calls } = setup({
      outcome: { kind: 'signed_in', user: USER, created: false, linked: true },
    });
    await service.login(CREDENTIAL, REQUEST);

    expect(calls).toEqual(['verify', 'users', 'log:account_linked', 'session', 'log:login']);
  });

  it('does not give the client address to the log: successes keep no address', async () => {
    const { service, records } = setup();
    await service.login(CREDENTIAL, REQUEST);

    expect(records.every((entry) => entry.ip === undefined)).toBe(true);
  });

  it('keeps the token and the email out of every log entry', async () => {
    const { service, records } = setup({
      outcome: { kind: 'signed_in', user: USER, created: true, linked: false },
    });
    await service.login(CREDENTIAL, REQUEST);

    const written = JSON.stringify(records);
    expect(written).not.toContain(CREDENTIAL);
    expect(written).not.toContain('T'.repeat(43));
    expect(written).not.toContain('ana@example.com');
  });
});

describe('GoogleLoginService.login, when the token is refused', () => {
  it('answers 401 INVALID_GOOGLE_TOKEN and logs invalid_token when the verifier says so', async () => {
    const { service, calls, records, signInWithGoogle, open } = setup({
      verifyError: new InvalidGoogleTokenError(),
    });
    const error = await failureOf(service.login(CREDENTIAL, REQUEST));

    expect(error).toMatchObject({ statusCode: 401, code: 'INVALID_GOOGLE_TOKEN' });
    expect(calls).toEqual(['verify', 'log:login_failed']);
    expect(records).toEqual([
      {
        userId: null,
        eventType: 'login_failed',
        success: false,
        userAgent: 'Chrome en Android',
        ip: '203.0.113.77',
        reason: 'invalid_token',
        now: NOW,
      },
    ]);
    expect(signInWithGoogle).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    ['an unverified email', { emailVerified: false }, 'email_unverified'],
    ['a token without a verified flag', { emailVerified: undefined }, 'email_unverified'],
    ['a token of an hour ago', { issuedAt: nowS - 3600 }, 'token_too_old'],
    ['a token without iat', { issuedAt: undefined }, 'token_too_old'],
    ['a token without sub', { subject: undefined }, 'invalid_token'],
    ['a token without email', { email: undefined }, 'invalid_token'],
    ['a token issued in the future', { issuedAt: nowS + 3600 }, 'invalid_token'],
  ] as const)(
    'answers the same 401 for %s and keeps the reason for the log',
    async (_n, change, reason) => {
      const { service, records, signInWithGoogle, open } = setup({
        claims: { ...GOOD_CLAIMS, ...change },
      });
      const error = await failureOf(service.login(CREDENTIAL, REQUEST));

      expect(error).toMatchObject({
        statusCode: 401,
        code: 'INVALID_GOOGLE_TOKEN',
        message: 'The Google sign-in could not be verified',
      });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ eventType: 'login_failed', success: false, reason });
      expect(signInWithGoogle).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    },
  );

  it('gives the 401 the same text for every reason', async () => {
    const messages = new Set<string>();
    for (const verifyError of [new InvalidGoogleTokenError('one'), undefined]) {
      const { service } = setup({
        verifyError,
        claims: { ...GOOD_CLAIMS, emailVerified: false },
      });
      messages.add((await failureOf(service.login(CREDENTIAL, REQUEST))).message);
    }
    expect(messages.size).toBe(1);
  });

  it('answers 401 and logs email_conflict when the email belongs to another Google identity', async () => {
    const { service, records, open } = setup({ outcome: { kind: 'email_conflict' } });
    const error = await failureOf(service.login(CREDENTIAL, REQUEST));

    expect(error).toMatchObject({ statusCode: 401, code: 'INVALID_GOOGLE_TOKEN' });
    expect(records[0]).toMatchObject({ userId: null, reason: 'email_conflict' });
    expect(open).not.toHaveBeenCalled();
  });

  it('answers 403 ACCOUNT_DISABLED and logs user_inactive with the person, without a session', async () => {
    const { service, records, open } = setup({ outcome: { kind: 'inactive', userId: USER.id } });
    const error = await failureOf(service.login(CREDENTIAL, REQUEST));

    expect(error).toMatchObject({ statusCode: 403, code: 'ACCOUNT_DISABLED' });
    expect(records).toEqual([
      expect.objectContaining({
        userId: USER.id,
        eventType: 'login_failed',
        success: false,
        reason: 'user_inactive',
        ip: '203.0.113.77',
      }),
    ]);
    expect(open).not.toHaveBeenCalled();
  });

  it('never puts the token or the email in the entry of a failure', async () => {
    const { service, records } = setup({ claims: { ...GOOD_CLAIMS, emailVerified: false } });
    await failureOf(service.login(CREDENTIAL, REQUEST));

    const written = JSON.stringify(records);
    expect(written).not.toContain(CREDENTIAL);
    expect(written).not.toContain('ana@example.com');
  });
});

describe('GoogleLoginService.login, when something cannot be reached', () => {
  it('answers 503 AUTH_PROVIDER_UNAVAILABLE, not 401, when Google cannot be reached', async () => {
    const { service, records, signInWithGoogle } = setup({
      verifyError: new GoogleUnavailableError(),
    });
    const error = await failureOf(service.login(CREDENTIAL, REQUEST));

    expect(error).toMatchObject({ statusCode: 503, code: 'AUTH_PROVIDER_UNAVAILABLE' });
    expect(records[0]).toMatchObject({ eventType: 'login_failed', reason: 'provider_unavailable' });
    expect(signInWithGoogle).not.toHaveBeenCalled();
  });

  it('answers 503 DATABASE_UNAVAILABLE and opens no session when the account cannot be read', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { service, open } = setup({ usersError: new Error('connection lost') });
      const error = await failureOf(service.login(CREDENTIAL, REQUEST));

      expect(error).toMatchObject({ statusCode: 503, code: 'DATABASE_UNAVAILABLE' });
      expect(open).not.toHaveBeenCalled();
    } finally {
      quiet.mockRestore();
    }
  });

  it('lets the 503 of the session service through, with register already written but no login', async () => {
    const { service, calls } = setup({
      outcome: { kind: 'signed_in', user: USER, created: true, linked: false },
      sessionError: new AppError(
        503,
        'DATABASE_UNAVAILABLE',
        'The database is not available right now',
      ),
    });
    const error = await failureOf(service.login(CREDENTIAL, REQUEST));

    expect(error).toMatchObject({ statusCode: 503, code: 'DATABASE_UNAVAILABLE' });
    expect(calls).toEqual(['verify', 'users', 'log:register', 'session']);
  });

  it('answers 503 AUTH_NOT_CONFIGURED without touching anything when there is no client ID', async () => {
    const { service, verify, signInWithGoogle, record } = setup({ configured: false });

    expect(service.isConfigured).toBe(false);
    const error = await failureOf(service.login(CREDENTIAL, REQUEST));
    expect(error).toMatchObject({ statusCode: 503, code: 'AUTH_NOT_CONFIGURED' });
    expect(verify).not.toHaveBeenCalled();
    expect(signInWithGoogle).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('knows it is configured when it has a verifier', () => {
    expect(setup().service.isConfigured).toBe(true);
  });

  it('does not hide a bug: an error nobody expected goes up as it is', async () => {
    const bug = new TypeError('something broke');
    const { service, records } = setup({ verifyError: bug });

    await expect(service.login(CREDENTIAL, REQUEST)).rejects.toBe(bug);
    expect(records).toHaveLength(0);
  });
});

describe('GoogleLoginService.login and the audit log', () => {
  it('lets the person in even when the log cannot be written', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { service } = setup({
        logError: new Error('log table is gone'),
        outcome: { kind: 'signed_in', user: USER, created: true, linked: false },
      });
      const result = await service.login(CREDENTIAL, REQUEST);

      expect(result.user).toEqual(USER);
    } finally {
      quiet.mockRestore();
    }
  });

  it('still answers the right error when the log of a failure cannot be written', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { service } = setup({
        logError: new Error('log table is gone'),
        verifyError: new InvalidGoogleTokenError(),
      });
      const error = await failureOf(service.login(CREDENTIAL, REQUEST));

      expect(error).toMatchObject({ statusCode: 401, code: 'INVALID_GOOGLE_TOKEN' });
    } finally {
      quiet.mockRestore();
    }
  });

  it('works without a user agent or an address', async () => {
    const { service, records } = setup({ verifyError: new InvalidGoogleTokenError() });
    await failureOf(service.login(CREDENTIAL));

    expect(records[0]).toMatchObject({ userAgent: undefined, ip: undefined });
  });
});

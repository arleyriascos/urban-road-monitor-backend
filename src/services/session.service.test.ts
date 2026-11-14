import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAY_MS, SESSION_RENEW_EVERY_MS } from '../auth/session-config.js';
import { hashSessionToken } from '../auth/session-token.js';
import { AppError } from '../errors/app-error.js';
import type { SessionRecord } from '../repositories/session.repository.js';
import { SessionService } from './session.service.js';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const TOKEN = 'A'.repeat(43);

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'session-1',
    userId: 'user-1',
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 7 * DAY_MS),
    revokedAt: null,
    userIsActive: true,
    userDeletedAt: null,
    email: 'ana@example.com',
    fullName: 'Ana Pérez',
    ...overrides,
  };
}

function setup(found: SessionRecord | null = record()) {
  const sessions = {
    open: vi.fn(async () => ({ id: 'session-1', expiresAt: new Date(NOW.getTime() + 7 * DAY_MS) })),
    findByTokenHash: vi.fn(async () => found),
    renew: vi.fn(async () => true),
    revoke: vi.fn(async () => true),
  };
  const logs = { record: vi.fn(async () => undefined) };
  const service = new SessionService(sessions, logs, () => NOW);
  return { sessions, logs, service };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SessionService.open', () => {
  it('returns the identifier once and gives the repository only its hash', async () => {
    const { sessions, service } = setup();

    const opened = await service.open('user-1', 'Chrome en Android');

    expect(opened.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(opened.sessionId).toBe('session-1');
    expect(sessions.open).toHaveBeenCalledWith({
      userId: 'user-1',
      tokenHash: hashSessionToken(opened.token),
      userAgent: 'Chrome en Android',
      now: NOW,
    });
    expect(JSON.stringify(sessions.open.mock.calls)).not.toContain(opened.token);
  });

  it('cuts the user agent before it reaches the repository', async () => {
    const { sessions, service } = setup();
    await service.open('user-1', 'x'.repeat(500));
    const [call] = sessions.open.mock.calls[0] as unknown as [{ userAgent: string }];
    expect(call.userAgent).toHaveLength(255);
  });

  it('answers 503 when the database fails', async () => {
    const { sessions, service } = setup();
    sessions.open.mockRejectedValueOnce(new Error('connection refused'));
    await expect(service.open('user-1')).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe('SessionService.authenticate', () => {
  it('knows the person behind a working session', async () => {
    const { service } = setup();
    expect(await service.authenticate(TOKEN)).toEqual({
      sessionId: 'session-1',
      userId: 'user-1',
      email: 'ana@example.com',
      fullName: 'Ana Pérez',
    });
  });

  it('looks the session up by the hash of the identifier, never by the identifier', async () => {
    const { sessions, service } = setup();
    await service.authenticate(TOKEN);
    expect(sessions.findByTokenHash).toHaveBeenCalledWith(hashSessionToken(TOKEN));
  });

  it('does not renew a session that was renewed less than an hour ago', async () => {
    const { sessions, service } = setup(record());
    await service.authenticate(TOKEN);
    expect(sessions.renew).not.toHaveBeenCalled();
  });

  it('renews a session whose last renewal was more than an hour ago', async () => {
    const found = record({
      createdAt: new Date(NOW.getTime() - 2 * DAY_MS),
      expiresAt: new Date(NOW.getTime() + 7 * DAY_MS - SESSION_RENEW_EVERY_MS - 1000),
    });
    const { sessions, service } = setup(found);

    expect(await service.authenticate(TOKEN)).not.toBeNull();

    expect(sessions.renew).toHaveBeenCalledWith('session-1', found.createdAt, NOW);
  });

  it('still answers the person when the renewal fails', async () => {
    const found = record({
      expiresAt: new Date(NOW.getTime() + 3 * DAY_MS),
    });
    const { sessions, service } = setup(found);
    sessions.renew.mockRejectedValueOnce(new Error('timeout'));
    expect(await service.authenticate(TOKEN)).not.toBeNull();
  });

  it.each([
    ['an empty text', ''],
    ['a short text', 'abc'],
    ['a text of the wrong length', 'A'.repeat(44)],
    ['a forbidden character', `${'A'.repeat(42)}!`],
  ])('answers null for %s without asking the database', async (_case, token) => {
    const { sessions, logs, service } = setup();
    expect(await service.authenticate(token)).toBeNull();
    expect(sessions.findByTokenHash).not.toHaveBeenCalled();
    expect(logs.record).not.toHaveBeenCalled();
  });

  it('answers null for a hash nobody has, and writes no log', async () => {
    const { logs, service } = setup(null);
    expect(await service.authenticate(TOKEN)).toBeNull();
    expect(logs.record).not.toHaveBeenCalled();
  });

  describe.each([
    ['revoked', record({ revokedAt: new Date(NOW.getTime() - 1000) })],
    ['expired', record({ expiresAt: new Date(NOW.getTime() - 1000) })],
    ['expired', record({ expiresAt: NOW })],
    ['user_inactive', record({ userIsActive: false })],
    ['user_inactive', record({ userDeletedAt: new Date(NOW.getTime() - DAY_MS) })],
  ])('a session that is %s', (reason, found) => {
    it('answers null, logs only the reason, and does not renew', async () => {
      const { sessions, logs, service } = setup(found);

      expect(
        await service.authenticate(TOKEN, { userAgent: 'Chrome', ip: '203.0.113.77' }),
      ).toBeNull();

      expect(logs.record).toHaveBeenCalledWith({
        userId: 'user-1',
        eventType: 'session_rejected',
        success: false,
        userAgent: 'Chrome',
        ip: '203.0.113.77',
        reason,
        now: NOW,
      });
      expect(sessions.renew).not.toHaveBeenCalled();
      expect(JSON.stringify(logs.record.mock.calls)).not.toContain(TOKEN);
      expect(JSON.stringify(logs.record.mock.calls)).not.toContain('ana@example.com');
    });
  });

  it('reports a revoked session as revoked even if it also expired', async () => {
    const { logs, service } = setup(
      record({
        revokedAt: new Date(NOW.getTime() - 5000),
        expiresAt: new Date(NOW.getTime() - 1000),
      }),
    );
    await service.authenticate(TOKEN);
    expect(logs.record).toHaveBeenCalledWith(expect.objectContaining({ reason: 'revoked' }));
  });

  it('still answers null when the log cannot be written', async () => {
    const { logs, service } = setup(record({ userIsActive: false }));
    logs.record.mockRejectedValueOnce(new Error('disk full'));
    expect(await service.authenticate(TOKEN)).toBeNull();
  });

  it('answers 503, never null, when the database does not answer', async () => {
    const { sessions, service } = setup();
    sessions.findByTokenHash.mockRejectedValueOnce(new Error('connection refused'));

    const failure = await service.authenticate(TOKEN).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ statusCode: 503, code: 'DATABASE_UNAVAILABLE' });
  });
});

describe('SessionService.revoke', () => {
  it('revokes the session at the current time', async () => {
    const { sessions, service } = setup();
    expect(await service.revoke('session-1')).toBe(true);
    expect(sessions.revoke).toHaveBeenCalledWith('session-1', NOW);
  });

  it('answers 503 when the database fails', async () => {
    const { sessions, service } = setup();
    sessions.revoke.mockRejectedValueOnce(new Error('connection refused'));
    await expect(service.revoke('session-1')).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe('SessionService.logout', () => {
  const session = { sessionId: 'session-1', userId: 'user-1' };

  it('revokes that one session and writes a successful logout of that person', async () => {
    const { sessions, logs, service } = setup();

    expect(await service.logout(session, { userAgent: 'Chrome en Android' })).toBe(true);

    expect(sessions.revoke).toHaveBeenCalledTimes(1);
    expect(sessions.revoke).toHaveBeenCalledWith('session-1', NOW);
    expect(logs.record).toHaveBeenCalledTimes(1);
    expect(logs.record).toHaveBeenCalledWith({
      userId: 'user-1',
      eventType: 'logout',
      success: true,
      userAgent: 'Chrome en Android',
      now: NOW,
    });
  });

  it('does not give the log the address of the client: a success keeps none', async () => {
    const { logs, service } = setup();
    await service.logout(session, { userAgent: 'Chrome', ip: '203.0.113.77' });

    expect(logs.record.mock.calls[0]).toBeDefined();
    expect(JSON.stringify(logs.record.mock.calls)).not.toContain('203.0.113.77');
  });

  it('answers false and writes nothing when the session had already stopped working', async () => {
    const { sessions, logs, service } = setup();
    sessions.revoke.mockResolvedValueOnce(false);

    expect(await service.logout(session)).toBe(false);
    expect(logs.record).not.toHaveBeenCalled();
  });

  it('answers 503 and writes nothing when the database fails', async () => {
    const { sessions, logs, service } = setup();
    sessions.revoke.mockRejectedValueOnce(new Error('connection refused'));

    await expect(service.logout(session)).rejects.toMatchObject({
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
    });
    expect(logs.record).not.toHaveBeenCalled();
  });

  it('still closes the session when the log cannot be written', async () => {
    const { logs, service } = setup();
    logs.record.mockRejectedValueOnce(new Error('disk full'));

    expect(await service.logout(session)).toBe(true);
  });
});

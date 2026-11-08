import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DAY_MS, MAX_SESSIONS_PER_USER, SESSION_MAX_MS } from '../auth/session-config.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  createTestClient,
  createTestUser,
  resetDatabase,
  testDatabaseUrl,
} from '../test/test-database.js';
import { SessionRepository } from './session.repository.js';

/**
 * These tests run against a real PostgreSQL: the part that can fail here is the SQL.
 * They are skipped when TEST_DATABASE_URL is not set (see src/test/test-database.ts).
 */
const url = testDatabaseUrl();
const T0 = new Date('2026-11-10T12:00:00.000Z');
const minutes = (count: number) => new Date(T0.getTime() + count * 60_000);

function hash(n: number): string {
  return n.toString(16).padStart(64, '0');
}

describe.skipIf(!url)('SessionRepository (real database)', () => {
  let db: PrismaClient;
  let repository: SessionRepository;

  beforeAll(() => {
    db = createTestClient(url!);
    repository = new SessionRepository(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
  });

  async function open(userId: string, n: number, now: Date, userAgent: string | null = null) {
    return repository.open({ userId, tokenHash: hash(n), userAgent, now });
  }

  async function sessionsOf(userId: string) {
    return db.sessions.findMany({ where: { user_id: userId }, orderBy: { created_at: 'asc' } });
  }

  describe('open', () => {
    it('stores the hash and the user agent, and expires seven days later', async () => {
      const userId = await createTestUser(db);
      const opened = await open(userId, 1, T0, 'Chrome en Android');

      expect(opened.expiresAt.toISOString()).toBe('2026-11-17T12:00:00.000Z');
      const [row] = await sessionsOf(userId);
      expect(row).toMatchObject({
        id: opened.id,
        token_hash: hash(1),
        user_agent: 'Chrome en Android',
        ip_address: null,
        revoked_at: null,
      });
      expect(row?.created_at.toISOString()).toBe(T0.toISOString());
    });

    it('allows five open sessions without revoking any', async () => {
      const userId = await createTestUser(db);
      for (let n = 1; n <= MAX_SESSIONS_PER_USER; n += 1) {
        await open(userId, n, minutes(n));
      }
      const rows = await sessionsOf(userId);
      expect(rows).toHaveLength(5);
      expect(rows.every((row) => row.revoked_at === null)).toBe(true);
    });

    it('revokes the session that expires first when the sixth opens', async () => {
      const userId = await createTestUser(db);
      for (let n = 1; n <= 5; n += 1) {
        await open(userId, n, minutes(n));
      }
      // Session 1 is used again, so session 2 now expires first.
      const first = await repository.findByTokenHash(hash(1));
      await repository.renew(first!.id, first!.createdAt, minutes(30));

      await open(userId, 6, minutes(40));

      const revoked = (await sessionsOf(userId)).filter((row) => row.revoked_at !== null);
      expect(revoked.map((row) => row.token_hash)).toEqual([hash(2)]);
      expect(revoked[0]?.revoked_at?.toISOString()).toBe(minutes(40).toISOString());
    });

    it('never touches the sessions of another person', async () => {
      const ana = await createTestUser(db);
      const luis = await createTestUser(db);
      for (let n = 1; n <= 5; n += 1) {
        await open(luis, 100 + n, minutes(n));
      }
      for (let n = 1; n <= 6; n += 1) {
        await open(ana, n, minutes(n));
      }
      const luisRows = await sessionsOf(luis);
      expect(luisRows).toHaveLength(5);
      expect(luisRows.every((row) => row.revoked_at === null)).toBe(true);
    });

    it("deletes that person's expired and revoked sessions, and only theirs", async () => {
      const ana = await createTestUser(db);
      const luis = await createTestUser(db);
      const expired = await open(ana, 1, T0);
      const revoked = await open(ana, 2, T0);
      await repository.revoke(revoked.id, minutes(1));
      await open(ana, 3, T0); // still open
      const luisExpired = await open(luis, 4, T0);

      const later = new Date(T0.getTime() + 8 * DAY_MS); // sessions 1, 2 and 3 expired by now
      await open(ana, 5, later);

      const anaHashes = (await sessionsOf(ana)).map((row) => row.token_hash);
      expect(anaHashes).toEqual([hash(5)]);
      expect(expired.id).toBeDefined();
      const luisRows = await sessionsOf(luis);
      expect(luisRows.map((row) => row.id)).toEqual([luisExpired.id]);
    });

    it('leaves exactly five open sessions when eight logins arrive together', async () => {
      const userId = await createTestUser(db);
      await Promise.all(
        Array.from({ length: 8 }, (_unused, index) => open(userId, index + 1, minutes(index + 1))),
      );
      const rows = await sessionsOf(userId);
      const stillOpen = rows.filter((row) => row.revoked_at === null);
      expect(stillOpen).toHaveLength(MAX_SESSIONS_PER_USER);
      // Each login deletes the revoked rows of the one before, so only the last revoked one is left.
      expect(rows).toHaveLength(MAX_SESSIONS_PER_USER + 1);
    });

    it('refuses a hash that is already used', async () => {
      const userId = await createTestUser(db);
      await open(userId, 1, T0);
      await expect(open(userId, 1, minutes(1))).rejects.toThrow();
      expect(await sessionsOf(userId)).toHaveLength(1);
    });
  });

  describe('findByTokenHash', () => {
    it('joins the session with its user in one read', async () => {
      const userId = await createTestUser(db, { email: 'ana@example.com' });
      const opened = await open(userId, 1, T0);

      const found = await repository.findByTokenHash(hash(1));

      expect(found).toEqual({
        id: opened.id,
        userId,
        createdAt: T0,
        expiresAt: opened.expiresAt,
        revokedAt: null,
        userIsActive: true,
        userDeletedAt: null,
        email: 'ana@example.com',
        fullName: expect.stringContaining('Test User'),
      });
    });

    it('returns null for a hash nobody has', async () => {
      expect(await repository.findByTokenHash(hash(999))).toBeNull();
    });

    it('shows a revoked session as revoked', async () => {
      const userId = await createTestUser(db);
      const opened = await open(userId, 1, T0);
      await repository.revoke(opened.id, minutes(5));
      expect((await repository.findByTokenHash(hash(1)))?.revokedAt).toEqual(minutes(5));
    });

    it('shows a deactivated user as inactive on the very next read', async () => {
      const userId = await createTestUser(db);
      await open(userId, 1, T0);
      expect((await repository.findByTokenHash(hash(1)))?.userIsActive).toBe(true);

      await db.users.update({
        where: { id: userId },
        data: { is_active: false, deleted_at: minutes(10) },
      });

      const found = await repository.findByTokenHash(hash(1));
      expect(found?.userIsActive).toBe(false);
      expect(found?.userDeletedAt).toEqual(minutes(10));
    });
  });

  describe('renew', () => {
    it('moves the expiry to seven days after the renewal', async () => {
      const userId = await createTestUser(db);
      const opened = await open(userId, 1, T0);
      const now = new Date(T0.getTime() + 2 * DAY_MS);

      expect(await repository.renew(opened.id, T0, now)).toBe(true);

      const found = await repository.findByTokenHash(hash(1));
      expect(found?.expiresAt.toISOString()).toBe('2026-11-19T12:00:00.000Z');
    });

    it('never goes past 30 days after the session was created', async () => {
      const userId = await createTestUser(db);
      const opened = await open(userId, 1, T0);
      const now = new Date(T0.getTime() + 28 * DAY_MS);

      await repository.renew(opened.id, T0, now);

      const found = await repository.findByTokenHash(hash(1));
      expect(found?.expiresAt.getTime()).toBe(T0.getTime() + SESSION_MAX_MS);
    });

    it('does not write when the expiry would not move later', async () => {
      const userId = await createTestUser(db);
      const opened = await open(userId, 1, T0);
      const now = new Date(T0.getTime() + 29.5 * DAY_MS);
      await repository.renew(opened.id, T0, now); // reaches the 30-day limit
      expect(await repository.renew(opened.id, T0, new Date(now.getTime() + 60_000))).toBe(false);
    });

    it('does not renew a revoked session', async () => {
      const userId = await createTestUser(db);
      const opened = await open(userId, 1, T0);
      await repository.revoke(opened.id, minutes(1));
      expect(await repository.renew(opened.id, T0, minutes(120))).toBe(false);
      expect((await repository.findByTokenHash(hash(1)))?.expiresAt).toEqual(opened.expiresAt);
    });
  });

  describe('revoke', () => {
    it('marks the session as revoked and keeps the row', async () => {
      const userId = await createTestUser(db);
      const opened = await open(userId, 1, T0);

      expect(await repository.revoke(opened.id, minutes(3))).toBe(true);

      const [row] = await sessionsOf(userId);
      expect(row?.revoked_at).toEqual(minutes(3));
    });

    it('does nothing the second time, and keeps the first revocation time', async () => {
      const userId = await createTestUser(db);
      const opened = await open(userId, 1, T0);
      await repository.revoke(opened.id, minutes(3));

      expect(await repository.revoke(opened.id, minutes(9))).toBe(false);
      expect((await sessionsOf(userId))[0]?.revoked_at).toEqual(minutes(3));
    });
  });
});

describe.skipIf(!url)('migration 08 (real database)', () => {
  let db: PrismaClient;

  beforeAll(() => {
    db = createTestClient(url!);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
  });

  it('adds the usuario role without any permission', async () => {
    const role = await db.roles.findUnique({
      where: { name: 'usuario' },
      include: { role_permissions: true },
    });
    expect(role).not.toBeNull();
    expect(role?.role_permissions).toHaveLength(0);
  });

  it('keeps the colaborador and administrador roles', async () => {
    const names = (await db.roles.findMany({ select: { name: true } })).map((role) => role.name);
    expect(names).toEqual(expect.arrayContaining(['colaborador', 'administrador', 'usuario']));
  });

  it('refuses an email with capital letters', async () => {
    await expect(
      db.users.create({ data: { email: 'Ana@Example.com', full_name: 'Ana' } }),
    ).rejects.toThrow();
  });

  it('accepts the new audit events with a reason', async () => {
    const userId = await createTestUser(db);
    const row = await db.auth_logs.create({
      data: { user_id: userId, event_type: 'session_rejected', success: false, reason: 'revoked' },
    });
    expect(row.reason).toBe('revoked');
  });

  it('still refuses an event type that does not exist', async () => {
    await expect(
      db.auth_logs.create({ data: { event_type: 'made_up', success: true } }),
    ).rejects.toThrow();
  });
});

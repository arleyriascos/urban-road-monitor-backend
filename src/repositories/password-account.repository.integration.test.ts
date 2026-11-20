import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  createTestClient,
  createTestUser,
  resetDatabase,
  testDatabaseUrl,
} from '../test/test-database.js';
import { PasswordAccountRepository } from './password-account.repository.js';

/** The password accounts against a real PostgreSQL. Skipped when TEST_DATABASE_URL is not set. */
const url = testDatabaseUrl();
const T0 = new Date('2026-11-10T12:00:00.000Z');
const LATER = new Date('2026-11-11T08:30:00.000Z');
const HASH = 'scrypt$16384$8$1$c2FsdA$aGFzaA';
const NEW_HASH = 'scrypt$16384$8$1$b3RoZXI$bmV3aGFzaA';

describe.skipIf(!url)('PasswordAccountRepository (real database)', () => {
  let db: PrismaClient;
  let repository: PasswordAccountRepository;

  beforeAll(() => {
    db = createTestClient(url!);
    repository = new PasswordAccountRepository(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
  });

  const account = (overrides = {}) => ({
    email: 'ana@example.com',
    fullName: 'Ana Pérez',
    passwordHash: HASH,
    now: T0,
    ...overrides,
  });

  async function openSession(userId: string, name: string) {
    return db.sessions.create({
      data: { user_id: userId, token_hash: `hash-${name}`, expires_at: new Date('2027-01-01') },
    });
  }

  describe('register', () => {
    it('makes the user, the password and the base role, with the email not verified', async () => {
      const result = await repository.register(account());

      expect(result.kind).toBe('created');
      if (result.kind !== 'created') {
        return;
      }
      expect(result.user).toMatchObject({
        email: 'ana@example.com',
        fullName: 'Ana Pérez',
        avatarUrl: null,
        roles: ['usuario'],
      });
      const user = await db.users.findUniqueOrThrow({
        where: { id: result.user.id },
        include: { password_credentials: true, oauth_accounts: true },
      });
      expect(user.email_verified_at).toBeNull();
      expect(user.last_login_at).toEqual(T0);
      expect(user.password_credentials?.password_hash).toBe(HASH);
      expect(user.oauth_accounts).toHaveLength(0);
    });

    it('answers email_taken for any account with that email, and changes nothing', async () => {
      await createTestUser(db, { email: 'ana@example.com' });
      await createTestUser(db, { email: 'off@example.com', isActive: false });

      expect(await repository.register(account())).toEqual({ kind: 'email_taken' });
      expect(await repository.register(account({ email: 'off@example.com' }))).toEqual({
        kind: 'email_taken',
      });
      expect(await db.users.count()).toBe(2);
      expect(await db.password_credentials.count()).toBe(0);
    });

    it('lets only one of two registrations at the same time win', async () => {
      const results = await Promise.all([
        repository.register(account()),
        repository.register(account()),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual(['created', 'email_taken']);
      expect(await db.users.count()).toBe(1);
    });
  });

  describe('findForLogin', () => {
    it('finds the account with its hash', async () => {
      const userId = await createTestUser(db, { email: 'ana@example.com', passwordHash: HASH });
      const found = await repository.findForLogin('ana@example.com');
      expect(found).toMatchObject({ passwordHash: HASH, isActive: true });
      expect(found?.user.id).toBe(userId);
    });

    it('answers null for an unknown email and for an account with no password', async () => {
      await createTestUser(db, { email: 'google@example.com' });
      expect(await repository.findForLogin('nobody@example.com')).toBeNull();
      expect(await repository.findForLogin('google@example.com')).toBeNull();
    });

    it('says when the account is deactivated', async () => {
      await createTestUser(db, { email: 'off@example.com', isActive: false, passwordHash: HASH });
      expect(await repository.findForLogin('off@example.com')).toMatchObject({ isActive: false });
    });
  });

  describe('touchLogin and findHash', () => {
    it('writes the time of the sign-in', async () => {
      const userId = await createTestUser(db, { passwordHash: HASH });
      await repository.touchLogin(userId, LATER);
      const user = await db.users.findUniqueOrThrow({ where: { id: userId } });
      expect(user.last_login_at).toEqual(LATER);
    });

    it('reads the hash of an active account only', async () => {
      const active = await createTestUser(db, { passwordHash: HASH });
      const off = await createTestUser(db, { isActive: false, passwordHash: HASH });
      const google = await createTestUser(db);
      expect(await repository.findHash(active)).toBe(HASH);
      expect(await repository.findHash(off)).toBeNull();
      expect(await repository.findHash(google)).toBeNull();
    });
  });

  describe('changePassword', () => {
    it('replaces the hash and closes the other sessions, keeping the current one and other people’s', async () => {
      const userId = await createTestUser(db, { passwordHash: HASH });
      const otherId = await createTestUser(db, { passwordHash: HASH });
      const current = await openSession(userId, 'current');
      const phone = await openSession(userId, 'phone');
      const alreadyClosed = await db.sessions.create({
        data: {
          user_id: userId,
          token_hash: 'hash-closed',
          expires_at: new Date('2027-01-01'),
          revoked_at: new Date('2026-11-01'),
        },
      });
      const stranger = await openSession(otherId, 'stranger');

      const closed = await repository.changePassword({
        userId,
        passwordHash: NEW_HASH,
        keepSessionId: current.id,
        now: LATER,
      });

      expect(closed).toBe(1);
      expect(await repository.findHash(userId)).toBe(NEW_HASH);
      expect(await repository.findHash(otherId)).toBe(HASH);
      const revoked = async (id: string) =>
        (await db.sessions.findUniqueOrThrow({ where: { id } })).revoked_at;
      expect(await revoked(current.id)).toBeNull();
      expect(await revoked(phone.id)).toEqual(LATER);
      expect(await revoked(alreadyClosed.id)).toEqual(new Date('2026-11-01'));
      expect(await revoked(stranger.id)).toBeNull();
    });

    it('answers null and touches nothing when the account has no password', async () => {
      const userId = await createTestUser(db);
      const session = await openSession(userId, 'google');
      const closed = await repository.changePassword({
        userId,
        passwordHash: NEW_HASH,
        keepSessionId: '00000000-0000-4000-8000-000000000000',
        now: LATER,
      });
      expect(closed).toBeNull();
      expect(await db.password_credentials.count()).toBe(0);
      expect(
        (await db.sessions.findUniqueOrThrow({ where: { id: session.id } })).revoked_at,
      ).toBeNull();
    });
  });
});

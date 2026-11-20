import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashEmailToken } from '../auth/email-token.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  createTestClient,
  createTestUser,
  resetDatabase,
  testDatabaseUrl,
} from '../test/test-database.js';
import { EmailTokenRepository } from './email-token.repository.js';

/** The e-mail links against a real PostgreSQL. Skipped when TEST_DATABASE_URL is not set. */
const url = testDatabaseUrl();
const T0 = new Date('2026-11-20T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const HASH = 'scrypt$16384$8$1$c2FsdA$aGFzaA';
const NEW_HASH = 'scrypt$16384$8$1$b3RoZXI$bmV3aGFzaA';

describe.skipIf(!url)('EmailTokenRepository (real database)', () => {
  let db: PrismaClient;
  let repository: EmailTokenRepository;

  beforeAll(() => {
    db = createTestClient(url!);
    repository = new EmailTokenRepository(db);
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase(db);
  });

  const hashOf = (name: string) => hashEmailToken(name.padEnd(43, 'x'));
  const issue = (userId: string, name: string, purpose: 'verify_email' | 'reset_password') =>
    repository.issue({
      userId,
      purpose,
      tokenHash: hashOf(name),
      expiresAt: new Date(T0.getTime() + HOUR),
      now: T0,
    });
  const usable = (name: string, purpose: 'verify_email' | 'reset_password', now = T0) =>
    repository.findUsable(purpose, hashOf(name), now);

  describe('issue and findUsable', () => {
    it('finds a token that is fresh, with the state of its account', async () => {
      const id = await createTestUser(db, { email: 'ana@example.com', passwordHash: HASH });
      await issue(id, 'one', 'reset_password');

      expect(await usable('one', 'reset_password')).toMatchObject({
        userId: id,
        email: 'ana@example.com',
        isActive: true,
        hasPassword: true,
        emailVerified: false,
      });
    });

    it('does not store the token, only its hash', async () => {
      const id = await createTestUser(db);
      await issue(id, 'one', 'verify_email');

      const rows = await db.email_tokens.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.token_hash).toBe(hashOf('one'));
      expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('does not find a token for another purpose, an unknown one or one that expired', async () => {
      const id = await createTestUser(db);
      await issue(id, 'one', 'verify_email');

      expect(await usable('one', 'reset_password')).toBeNull();
      expect(await usable('other', 'verify_email')).toBeNull();
      expect(await usable('one', 'verify_email', new Date(T0.getTime() + HOUR))).toBeNull();
      expect(await usable('one', 'verify_email', new Date(T0.getTime() + HOUR - 1))).not.toBeNull();
    });

    it('replaces the earlier links of the same purpose and leaves the other purpose alone', async () => {
      const id = await createTestUser(db);
      await issue(id, 'old', 'reset_password');
      await issue(id, 'verify', 'verify_email');
      await issue(id, 'new', 'reset_password');

      expect(await usable('old', 'reset_password')).toBeNull();
      expect(await usable('new', 'reset_password')).not.toBeNull();
      expect(await usable('verify', 'verify_email')).not.toBeNull();
    });

    it('reports an inactive account', async () => {
      const id = await createTestUser(db, { isActive: false });
      await issue(id, 'one', 'verify_email');
      expect((await usable('one', 'verify_email'))?.isActive).toBe(false);
    });
  });

  describe('accountState', () => {
    it('says the email, whether it is verified and whether there is a password', async () => {
      const id = await createTestUser(db, { email: 'a@example.com', emailVerifiedAt: T0 });
      expect(await repository.accountState(id)).toEqual({
        email: 'a@example.com',
        isActive: true,
        emailVerified: true,
        hasPassword: false,
      });
    });

    it('is null for an account that does not exist', async () => {
      expect(await repository.accountState('00000000-0000-4000-8000-000000000000')).toBeNull();
    });
  });

  describe('verifyEmail', () => {
    it('marks the token used and the email verified', async () => {
      const id = await createTestUser(db, { passwordHash: HASH });
      await issue(id, 'one', 'verify_email');
      const token = (await usable('one', 'verify_email'))!;

      expect(await repository.verifyEmail({ tokenId: token.tokenId, userId: id, now: T0 })).toBe(
        true,
      );

      const user = await db.users.findUniqueOrThrow({ where: { id } });
      expect(user.email_verified_at).toEqual(T0);
      expect(await usable('one', 'verify_email')).toBeNull();
    });

    it('works only once: the second use answers false and changes nothing', async () => {
      const id = await createTestUser(db);
      await issue(id, 'one', 'verify_email');
      const token = (await usable('one', 'verify_email'))!;
      const later = new Date(T0.getTime() + 1000);

      await repository.verifyEmail({ tokenId: token.tokenId, userId: id, now: T0 });
      expect(await repository.verifyEmail({ tokenId: token.tokenId, userId: id, now: later })).toBe(
        false,
      );
      expect((await db.users.findUniqueOrThrow({ where: { id } })).email_verified_at).toEqual(T0);
    });

    it('lets only one of two simultaneous uses win', async () => {
      const id = await createTestUser(db);
      await issue(id, 'one', 'verify_email');
      const token = (await usable('one', 'verify_email'))!;

      const results = await Promise.all([
        repository.verifyEmail({ tokenId: token.tokenId, userId: id, now: T0 }),
        repository.verifyEmail({ tokenId: token.tokenId, userId: id, now: T0 }),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('does not touch an email that was already verified', async () => {
      const earlier = new Date('2026-01-01T00:00:00Z');
      const id = await createTestUser(db, { emailVerifiedAt: earlier });
      await issue(id, 'one', 'verify_email');
      const token = (await usable('one', 'verify_email'))!;

      await repository.verifyEmail({ tokenId: token.tokenId, userId: id, now: T0 });

      expect((await db.users.findUniqueOrThrow({ where: { id } })).email_verified_at).toEqual(
        earlier,
      );
    });

    it('refuses a token that expired between the lookup and the use', async () => {
      const id = await createTestUser(db);
      await issue(id, 'one', 'verify_email');
      const token = (await usable('one', 'verify_email'))!;

      const late = new Date(T0.getTime() + 2 * HOUR);
      expect(await repository.verifyEmail({ tokenId: token.tokenId, userId: id, now: late })).toBe(
        false,
      );
      expect((await db.users.findUniqueOrThrow({ where: { id } })).email_verified_at).toBeNull();
    });
  });

  describe('resetPassword', () => {
    async function setup() {
      const id = await createTestUser(db, { passwordHash: HASH });
      await db.sessions.createMany({
        data: [
          { user_id: id, token_hash: 'hash-a', expires_at: new Date('2027-01-01') },
          { user_id: id, token_hash: 'hash-b', expires_at: new Date('2027-01-01') },
        ],
      });
      await issue(id, 'one', 'reset_password');
      const token = (await usable('one', 'reset_password'))!;
      return { id, token };
    }

    it('replaces the password, closes every session, verifies the email and uses the token', async () => {
      const { id, token } = await setup();

      const closed = await repository.resetPassword({
        tokenId: token.tokenId,
        userId: id,
        passwordHash: NEW_HASH,
        now: T0,
      });

      expect(closed).toBe(2);
      expect(
        (await db.password_credentials.findUniqueOrThrow({ where: { user_id: id } })).password_hash,
      ).toBe(NEW_HASH);
      expect(await db.sessions.count({ where: { user_id: id, revoked_at: null } })).toBe(0);
      expect((await db.users.findUniqueOrThrow({ where: { id } })).email_verified_at).toEqual(T0);
      expect(await usable('one', 'reset_password')).toBeNull();
    });

    it('works only once and leaves the new password alone the second time', async () => {
      const { id, token } = await setup();
      const input = { tokenId: token.tokenId, userId: id, now: T0 };

      await repository.resetPassword({ ...input, passwordHash: NEW_HASH });
      const second = await repository.resetPassword({
        ...input,
        passwordHash: 'scrypt$16384$8$1$eHh4$eXl5',
      });

      expect(second).toBeNull();
      expect(
        (await db.password_credentials.findUniqueOrThrow({ where: { user_id: id } })).password_hash,
      ).toBe(NEW_HASH);
    });

    it('lets only one of two simultaneous uses win', async () => {
      const { id, token } = await setup();
      const input = { tokenId: token.tokenId, userId: id, now: T0 };

      const results = await Promise.all([
        repository.resetPassword({ ...input, passwordHash: NEW_HASH }),
        repository.resetPassword({ ...input, passwordHash: NEW_HASH }),
      ]);

      expect(results.filter((r) => r !== null)).toHaveLength(1);
    });

    it('undoes everything, token included, when the account has no password', async () => {
      const id = await createTestUser(db);
      await issue(id, 'one', 'reset_password');
      const token = (await usable('one', 'reset_password'))!;

      const result = await repository.resetPassword({
        tokenId: token.tokenId,
        userId: id,
        passwordHash: NEW_HASH,
        now: T0,
      });

      expect(result).toBeNull();
      expect(await usable('one', 'reset_password')).not.toBeNull();
      expect((await db.users.findUniqueOrThrow({ where: { id } })).email_verified_at).toBeNull();
    });

    it('does not touch the sessions of other people', async () => {
      const { id, token } = await setup();
      const other = await createTestUser(db);
      await db.sessions.create({
        data: { user_id: other, token_hash: 'hash-other', expires_at: new Date('2027-01-01') },
      });

      await repository.resetPassword({
        tokenId: token.tokenId,
        userId: id,
        passwordHash: NEW_HASH,
        now: T0,
      });

      expect(await db.sessions.count({ where: { user_id: other, revoked_at: null } })).toBe(1);
    });
  });
});

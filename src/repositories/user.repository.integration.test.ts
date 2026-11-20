import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  createTestClient,
  createTestUser,
  resetDatabase,
  testDatabaseUrl,
} from '../test/test-database.js';
import {
  BASE_ROLE,
  MissingBaseRoleError,
  UserRepository,
  type GoogleSignIn,
  type GoogleSignInOutcome,
} from './user.repository.js';

/**
 * The sign-in decision against a real PostgreSQL: what can fail here is the SQL, the unique
 * keys and the transaction. Skipped when TEST_DATABASE_URL is not set (see src/test/).
 */
const url = testDatabaseUrl();
const T0 = new Date('2026-11-10T12:00:00.000Z');
const LATER = new Date('2026-11-11T08:30:00.000Z');
const PHOTO = 'https://lh3.googleusercontent.com/a/ana=s96-c';

function signIn(overrides: Partial<GoogleSignIn> = {}): GoogleSignIn {
  return {
    subject: '110169484474386276334',
    email: 'ana@example.com',
    name: 'Ana Pérez',
    picture: PHOTO,
    now: T0,
    ...overrides,
  };
}

function signedIn(result: GoogleSignInOutcome) {
  if (result.kind !== 'signed_in') {
    throw new Error(`expected signed_in, got ${result.kind}`);
  }
  return result;
}

describe.skipIf(!url)('UserRepository (real database)', () => {
  let db: PrismaClient;
  let repository: UserRepository;

  beforeAll(() => {
    db = createTestClient(url!);
    repository = new UserRepository(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
  });

  const counts = async () => ({
    users: await db.users.count(),
    links: await db.oauth_accounts.count(),
    roles: await db.user_roles.count(),
  });

  async function giveRole(userId: string, name: string) {
    const role = await db.roles.findUniqueOrThrow({ where: { name } });
    await db.user_roles.create({ data: { user_id: userId, role_id: role.id } });
  }

  describe('a person who has no account', () => {
    it('gets an account, its Google link and the base role, all together', async () => {
      const result = signedIn(await repository.signInWithGoogle(signIn()));

      expect(result).toMatchObject({ created: true, linked: false });
      expect(result.user).toEqual({
        id: expect.any(String),
        email: 'ana@example.com',
        fullName: 'Ana Pérez',
        avatarUrl: PHOTO,
        roles: [BASE_ROLE],
      });

      const row = await db.users.findUniqueOrThrow({ where: { id: result.user.id } });
      expect(row).toMatchObject({ is_active: true, deleted_at: null, last_login_at: T0 });
      const link = await db.oauth_accounts.findFirstOrThrow({ where: { user_id: row.id } });
      expect(link).toMatchObject({
        provider: 'google',
        provider_account_id: '110169484474386276334',
      });
      expect(await counts()).toEqual({ users: 1, links: 1, roles: 1 });
    });

    it('uses the part of the email before the @ when Google sent no name', async () => {
      const result = signedIn(
        await repository.signInWithGoogle(
          signIn({ name: undefined, email: 'ana.perez@example.com' }),
        ),
      );
      expect(result.user.fullName).toBe('ana.perez');
    });

    it('stores no photo when the address is not https', async () => {
      const result = signedIn(
        await repository.signInWithGoogle(signIn({ picture: 'http://example.com/a.png' })),
      );
      expect(result.user.avatarUrl).toBeNull();
    });

    it('cuts a name of more than 150 characters, so the column accepts it', async () => {
      const result = signedIn(await repository.signInWithGoogle(signIn({ name: 'N'.repeat(400) })));
      expect(result.user.fullName).toHaveLength(150);
    });

    it('leaves nothing behind when the base role is missing', async () => {
      const role = await db.roles.findUniqueOrThrow({ where: { name: BASE_ROLE } });
      // Deleting a role deletes its permissions too, so they are kept to put them back.
      const granted = await db.role_permissions.findMany({ where: { role_id: role.id } });
      await db.roles.delete({ where: { id: role.id } });
      try {
        await expect(repository.signInWithGoogle(signIn())).rejects.toBeInstanceOf(
          MissingBaseRoleError,
        );
        expect(await counts()).toEqual({ users: 0, links: 0, roles: 0 });
      } finally {
        const restored = await db.roles.create({
          data: { name: role.name, description: role.description },
        });
        await db.role_permissions.createMany({
          data: granted.map((row) => ({ role_id: restored.id, permission_id: row.permission_id })),
        });
      }
    });
  });

  describe('a person who signs in again', () => {
    it('is recognised by the Google identity, and no account is made', async () => {
      const first = signedIn(await repository.signInWithGoogle(signIn()));
      const again = signedIn(await repository.signInWithGoogle(signIn({ now: LATER })));

      expect(again).toMatchObject({ created: false, linked: false });
      expect(again.user.id).toBe(first.user.id);
      expect(await counts()).toEqual({ users: 1, links: 1, roles: 1 });
      const row = await db.users.findUniqueOrThrow({ where: { id: first.user.id } });
      expect(row.last_login_at).toEqual(LATER);
    });

    it('takes the new name and photo from Google', async () => {
      await repository.signInWithGoogle(signIn());
      const again = signedIn(
        await repository.signInWithGoogle(
          signIn({ name: 'Ana M. Pérez', picture: 'https://example.com/new.png' }),
        ),
      );
      expect(again.user).toMatchObject({
        fullName: 'Ana M. Pérez',
        avatarUrl: 'https://example.com/new.png',
      });
    });

    it('keeps the stored name when Google sends none, and clears a photo Google no longer sends', async () => {
      await repository.signInWithGoogle(signIn());
      const again = signedIn(
        await repository.signInWithGoogle(signIn({ name: undefined, picture: undefined })),
      );
      expect(again.user).toMatchObject({ fullName: 'Ana Pérez', avatarUrl: null });
    });

    it('keeps the email it has when Google reports another one for the same identity', async () => {
      const first = signedIn(await repository.signInWithGoogle(signIn()));
      const again = signedIn(
        await repository.signInWithGoogle(signIn({ email: 'ana.nueva@example.com' })),
      );

      expect(again.user.id).toBe(first.user.id);
      expect(again.user.email).toBe('ana@example.com');
      expect(await counts()).toEqual({ users: 1, links: 1, roles: 1 });
    });

    it('never changes the roles, and lists them in alphabetical order', async () => {
      const first = signedIn(await repository.signInWithGoogle(signIn()));
      await giveRole(first.user.id, 'colaborador');
      await giveRole(first.user.id, 'administrador');

      const again = signedIn(await repository.signInWithGoogle(signIn({ now: LATER })));
      expect(again.user.roles).toEqual(['administrador', 'colaborador', BASE_ROLE]);
    });
  });

  describe('an account with the same email and no Google link', () => {
    it('links the Google identity to it, because Google verified the email', async () => {
      const userId = await createTestUser(db, { email: 'ana@example.com' });
      await giveRole(userId, 'colaborador');

      const result = signedIn(await repository.signInWithGoogle(signIn()));

      expect(result).toMatchObject({ created: false, linked: true });
      expect(result.user.id).toBe(userId);
      expect(result.user.roles).toEqual(['colaborador']);
      expect(await counts()).toEqual({ users: 1, links: 1, roles: 1 });
    });

    it('is the same account the next time, now by its Google identity', async () => {
      const userId = await createTestUser(db, { email: 'ana@example.com' });
      await repository.signInWithGoogle(signIn());
      const again = signedIn(await repository.signInWithGoogle(signIn({ now: LATER })));

      expect(again).toMatchObject({ created: false, linked: false });
      expect(again.user.id).toBe(userId);
    });

    it('is refused when the account is already linked to another Google identity', async () => {
      const first = signedIn(await repository.signInWithGoogle(signIn({ subject: 'old-sub' })));
      const before = await db.users.findUniqueOrThrow({ where: { id: first.user.id } });

      const result = await repository.signInWithGoogle(
        signIn({ subject: 'new-sub', name: 'Someone else', now: LATER }),
      );

      expect(result).toEqual({ kind: 'email_conflict' });
      expect(await counts()).toEqual({ users: 1, links: 1, roles: 1 });
      const after = await db.users.findUniqueOrThrow({ where: { id: first.user.id } });
      expect(after).toEqual(before);
    });
  });

  describe('an account with a password', () => {
    const HASH = 'scrypt$16384$8$1$c2FsdA$aGFzaA';

    async function openSession(userId: string) {
      return db.sessions.create({
        data: { user_id: userId, token_hash: `hash-${userId}`, expires_at: new Date('2027-01-01') },
      });
    }

    it('becomes the Google account when its email was never verified: no password, no old sessions', async () => {
      const userId = await createTestUser(db, { email: 'ana@example.com', passwordHash: HASH });
      const session = await openSession(userId);

      const result = signedIn(await repository.signInWithGoogle(signIn()));

      expect(result).toMatchObject({ created: false, linked: true });
      expect(result.user.id).toBe(userId);
      expect(await db.password_credentials.count()).toBe(0);
      const closed = await db.sessions.findUniqueOrThrow({ where: { id: session.id } });
      expect(closed.revoked_at).toEqual(T0);
      const user = await db.users.findUniqueOrThrow({ where: { id: userId } });
      expect(user.email_verified_at).toEqual(T0);
    });

    it('keeps its password and its sessions when its email was verified', async () => {
      const userId = await createTestUser(db, {
        email: 'ana@example.com',
        passwordHash: HASH,
        emailVerifiedAt: new Date('2026-11-01T00:00:00Z'),
      });
      const session = await openSession(userId);

      const result = signedIn(await repository.signInWithGoogle(signIn()));

      expect(result).toMatchObject({ created: false, linked: true });
      expect(await db.password_credentials.count()).toBe(1);
      const open = await db.sessions.findUniqueOrThrow({ where: { id: session.id } });
      expect(open.revoked_at).toBeNull();
    });
  });

  describe('the verified email', () => {
    it('is set to the sign-in time on a new Google account', async () => {
      const result = signedIn(await repository.signInWithGoogle(signIn()));
      const user = await db.users.findUniqueOrThrow({ where: { id: result.user.id } });
      expect(user.email_verified_at).toEqual(T0);
    });

    it('is filled in for a Google account that had none, and never moved afterwards', async () => {
      const first = signedIn(await repository.signInWithGoogle(signIn()));
      await db.users.update({ where: { id: first.user.id }, data: { email_verified_at: null } });
      await repository.signInWithGoogle(signIn({ now: LATER }));
      const filled = await db.users.findUniqueOrThrow({ where: { id: first.user.id } });
      expect(filled.email_verified_at).toEqual(LATER);

      await repository.signInWithGoogle(signIn({ now: new Date('2026-12-01T00:00:00Z') }));
      const same = await db.users.findUniqueOrThrow({ where: { id: first.user.id } });
      expect(same.email_verified_at).toEqual(LATER);
    });
  });

  describe('a deactivated or deleted account', () => {
    it('is not signed in when it is found by its Google identity, and nothing changes', async () => {
      const first = signedIn(await repository.signInWithGoogle(signIn()));
      await db.users.update({ where: { id: first.user.id }, data: { is_active: false } });
      const before = await db.users.findUniqueOrThrow({ where: { id: first.user.id } });

      const result = await repository.signInWithGoogle(
        signIn({ name: 'Changed', picture: undefined, now: LATER }),
      );

      expect(result).toEqual({ kind: 'inactive', userId: first.user.id });
      expect(await db.users.findUniqueOrThrow({ where: { id: first.user.id } })).toEqual(before);
    });

    it('is not linked when it is found by its email, and no link is created', async () => {
      const userId = await createTestUser(db, { email: 'ana@example.com', isActive: false });

      const result = await repository.signInWithGoogle(signIn());

      expect(result).toEqual({ kind: 'inactive', userId });
      expect(await counts()).toEqual({ users: 1, links: 0, roles: 0 });
    });

    it('counts a deleted account the same way', async () => {
      const first = signedIn(await repository.signInWithGoogle(signIn()));
      await db.users.update({
        where: { id: first.user.id },
        data: { is_active: false, deleted_at: T0 },
      });
      expect(await repository.signInWithGoogle(signIn({ now: LATER }))).toEqual({
        kind: 'inactive',
        userId: first.user.id,
      });
    });
  });

  describe('sign-ins at the same time', () => {
    it('make one account for the same new person, and all of them get it', async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => repository.signInWithGoogle(signIn())),
      );

      const accounts = results.map((result) => signedIn(result));
      expect(new Set(accounts.map((result) => result.user.id)).size).toBe(1);
      expect(accounts.filter((result) => result.created)).toHaveLength(1);
      expect(await counts()).toEqual({ users: 1, links: 1, roles: 1 });
    });

    it('try again when they collide with an account made a moment before, and join it', async () => {
      // The collision is made on purpose, not left to luck: one transaction inserts the email
      // and stays open, so the sign-in does not see it and tries to insert the same email.
      // The database makes it wait, and when the first one commits it fails on the unique key.
      const transaction = vi.spyOn(db, '$transaction');
      let inserted!: () => void;
      let release!: () => void;
      const hasInserted = new Promise<void>((resolve) => (inserted = resolve));
      const mayCommit = new Promise<void>((resolve) => (release = resolve));
      const holder = db.$transaction(async (tx) => {
        await tx.users.create({ data: { email: 'ana@example.com', full_name: 'Ana' } });
        inserted();
        await mayCommit;
      });
      await hasInserted;

      const signing = repository.signInWithGoogle(signIn());
      await new Promise((resolve) => setTimeout(resolve, 150));
      release();
      await holder;
      const result = signedIn(await signing);

      const row = await db.users.findUniqueOrThrow({ where: { email: 'ana@example.com' } });
      expect(result.user.id).toBe(row.id);
      expect(result).toMatchObject({ created: false, linked: true });
      expect(await counts()).toEqual({ users: 1, links: 1, roles: 0 });
      // The transaction that held the email, the first try of the sign-in and its second try.
      expect(transaction).toHaveBeenCalledTimes(3);
      transaction.mockRestore();
    });

    it('link the Google identity once to an account that already exists', async () => {
      const userId = await createTestUser(db, { email: 'ana@example.com' });
      const results = await Promise.all(
        Array.from({ length: 6 }, () => repository.signInWithGoogle(signIn())),
      );

      const accounts = results.map((result) => signedIn(result));
      expect(accounts.every((result) => result.user.id === userId)).toBe(true);
      expect(accounts.filter((result) => result.linked)).toHaveLength(1);
      expect(await counts()).toEqual({ users: 1, links: 1, roles: 0 });
    });

    it('do not mix up different people', async () => {
      const results = await Promise.all(
        ['1', '2', '3', '4'].map((n) =>
          repository.signInWithGoogle(signIn({ subject: n, email: `person${n}@example.com` })),
        ),
      );
      const ids = results.map((result) => signedIn(result).user.id);
      expect(new Set(ids).size).toBe(4);
      expect(await counts()).toEqual({ users: 4, links: 4, roles: 4 });
    });
  });
});

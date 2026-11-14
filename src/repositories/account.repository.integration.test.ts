import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  createTestClient,
  createTestUser,
  giveRole,
  resetDatabase,
  testDatabaseUrl,
} from '../test/test-database.js';
import { AccountRepository } from './account.repository.js';

/**
 * The profile and the permission check against a real PostgreSQL, with the roles and the
 * permissions that the seed data creates. What can fail here is the SQL. Skipped when
 * TEST_DATABASE_URL is not set (see src/test/).
 */
const url = testDatabaseUrl();

const COLLABORATOR_PERMISSIONS = [
  'detections.create',
  'potholes.report_repair',
  'routes.view_history',
  'trips.view_own',
];

describe.skipIf(!url)('AccountRepository (real database)', () => {
  let db: PrismaClient;
  let repository: AccountRepository;

  beforeAll(() => {
    db = createTestClient(url!);
    repository = new AccountRepository(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
  });

  describe('findProfile', () => {
    it('gives a person with only the base role no permission at all', async () => {
      const userId = await createTestUser(db, { email: 'ana@example.com' });
      await giveRole(db, userId, 'usuario');

      expect(await repository.findProfile(userId)).toEqual({
        id: userId,
        email: 'ana@example.com',
        fullName: expect.any(String),
        avatarUrl: null,
        roles: ['usuario'],
        permissions: [],
      });
    });

    it('answers the photo of the account when it has one', async () => {
      const userId = await createTestUser(db);
      await db.users.update({
        where: { id: userId },
        data: { avatar_url: 'https://lh3.example.com/a/photo=s96-c' },
      });
      expect((await repository.findProfile(userId))?.avatarUrl).toBe(
        'https://lh3.example.com/a/photo=s96-c',
      );
    });

    it('gives a collaborator the four permissions of the role, in alphabetical order', async () => {
      const userId = await createTestUser(db);
      await giveRole(db, userId, 'usuario');
      await giveRole(db, userId, 'colaborador');

      const profile = await repository.findProfile(userId);

      expect(profile?.roles).toEqual(['colaborador', 'usuario']);
      expect(profile?.permissions).toEqual(COLLABORATOR_PERMISSIONS);
    });

    it('gives an administrator the nine permissions once each, even with two roles that grant them', async () => {
      const userId = await createTestUser(db);
      await giveRole(db, userId, 'colaborador');
      await giveRole(db, userId, 'administrador');

      const profile = await repository.findProfile(userId);

      expect(profile?.permissions).toHaveLength(9);
      expect(new Set(profile?.permissions).size).toBe(9);
      expect(profile?.permissions).toEqual([...(profile?.permissions ?? [])].sort());
      expect(profile?.permissions).toContain('users.manage');
    });

    it('does not mix the roles of two people', async () => {
      const ana = await createTestUser(db, { email: 'ana@example.com' });
      const luis = await createTestUser(db, { email: 'luis@example.com' });
      await giveRole(db, ana, 'administrador');
      await giveRole(db, luis, 'usuario');

      expect((await repository.findProfile(luis))?.permissions).toEqual([]);
      expect((await repository.findProfile(ana))?.roles).toEqual(['administrador']);
    });

    it('reads the roles at every call: a role given later shows up at once', async () => {
      const userId = await createTestUser(db);
      await giveRole(db, userId, 'usuario');
      expect((await repository.findProfile(userId))?.permissions).toEqual([]);

      await giveRole(db, userId, 'colaborador');

      expect((await repository.findProfile(userId))?.permissions).toEqual(COLLABORATOR_PERMISSIONS);
    });

    it('answers null for a deactivated account, a deleted one and an unknown one', async () => {
      const deactivated = await createTestUser(db, { isActive: false });
      await giveRole(db, deactivated, 'administrador');
      const deleted = await createTestUser(db);
      // The database does not allow a deleted account that is still active.
      await db.users.update({
        where: { id: deleted },
        data: { is_active: false, deleted_at: new Date() },
      });

      expect(await repository.findProfile(deactivated)).toBeNull();
      expect(await repository.findProfile(deleted)).toBeNull();
      expect(await repository.findProfile('5f0b3c2e-0000-4000-8000-0000000000ff')).toBeNull();
    });
  });

  describe('hasPermission', () => {
    it('is false for a person with only the base role', async () => {
      const userId = await createTestUser(db);
      await giveRole(db, userId, 'usuario');

      expect(await repository.hasPermission(userId, 'detections.create')).toBe(false);
    });

    it('is false for a person with no role at all', async () => {
      const userId = await createTestUser(db);
      expect(await repository.hasPermission(userId, 'detections.create')).toBe(false);
    });

    it('is true for what the role grants and false for what it does not', async () => {
      const userId = await createTestUser(db);
      await giveRole(db, userId, 'colaborador');

      for (const code of COLLABORATOR_PERMISSIONS) {
        expect(await repository.hasPermission(userId, code)).toBe(true);
      }
      expect(await repository.hasPermission(userId, 'users.manage')).toBe(false);
      expect(await repository.hasPermission(userId, 'parameters.update')).toBe(false);
    });

    it('is true for every permission of an administrator', async () => {
      const userId = await createTestUser(db);
      await giveRole(db, userId, 'administrador');

      const profile = await repository.findProfile(userId);
      for (const code of profile?.permissions ?? []) {
        expect(await repository.hasPermission(userId, code)).toBe(true);
      }
    });

    it('is false for a code that does not exist, even for an administrator', async () => {
      const userId = await createTestUser(db);
      await giveRole(db, userId, 'administrador');

      expect(await repository.hasPermission(userId, 'nothing.at_all')).toBe(false);
    });

    it('is false the moment the person is deactivated, whatever their roles', async () => {
      const userId = await createTestUser(db);
      await giveRole(db, userId, 'administrador');
      expect(await repository.hasPermission(userId, 'users.manage')).toBe(true);

      await db.users.update({ where: { id: userId }, data: { is_active: false } });

      expect(await repository.hasPermission(userId, 'users.manage')).toBe(false);
    });

    it('is false for an unknown person', async () => {
      expect(
        await repository.hasPermission('5f0b3c2e-0000-4000-8000-0000000000ff', 'users.manage'),
      ).toBe(false);
    });
  });
});

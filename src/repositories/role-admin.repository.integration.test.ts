import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RoleCommand } from '../auth/role-command.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  createTestClient,
  createTestUser,
  giveRole,
  resetDatabase,
  testDatabaseUrl,
} from '../test/test-database.js';
import { RoleAdminRepository } from './role-admin.repository.js';

/**
 * The role changes against a real PostgreSQL: what can fail here is the SQL, the locks and the
 * transaction that keeps a change and its log together. Skipped without TEST_DATABASE_URL.
 */
const url = testDatabaseUrl();
const NOW = new Date('2026-11-10T12:00:00.000Z');

function add(email: string, role: RoleCommand['role']): RoleCommand {
  return { action: 'add', email, role };
}
function remove(email: string, role: RoleCommand['role']): RoleCommand {
  return { action: 'remove', email, role };
}

describe.skipIf(!url)('RoleAdminRepository (real database)', () => {
  let db: PrismaClient;
  let repository: RoleAdminRepository;

  beforeAll(() => {
    db = createTestClient(url!);
    repository = new RoleAdminRepository(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
  });

  /** A person with the base role and the given extra roles. */
  async function person(email: string, extraRoles: string[] = [], isActive = true) {
    const userId = await createTestUser(db, { email, isActive });
    await giveRole(db, userId, 'usuario');
    for (const role of extraRoles) {
      await giveRole(db, userId, role);
    }
    return userId;
  }

  const rolesOf = async (userId: string) =>
    (await db.user_roles.findMany({ where: { user_id: userId }, include: { roles: true } }))
      .map((row) => row.roles.name)
      .sort();
  const logs = () => db.auth_logs.findMany({ orderBy: { id: 'asc' } });
  const adminCount = () => db.user_roles.count({ where: { roles: { name: 'administrador' } } });

  describe('findAccount', () => {
    it('finds an account by its email and lists its roles in alphabetical order', async () => {
      const userId = await person('ana@example.com', ['colaborador']);

      expect(await repository.findAccount('ana@example.com')).toEqual({
        userId,
        email: 'ana@example.com',
        fullName: expect.any(String),
        isActive: true,
        roles: ['colaborador', 'usuario'],
      });
    });

    it('answers null when nobody has signed in with that email', async () => {
      expect(await repository.findAccount('nadie@example.com')).toBeNull();
    });

    it('marks a deactivated account', async () => {
      await person('ana@example.com', [], false);
      expect((await repository.findAccount('ana@example.com'))?.isActive).toBe(false);
    });
  });

  describe('adding a role', () => {
    it('adds it, answers the roles the person has now and writes one role_changed', async () => {
      const userId = await person('ana@example.com');

      expect(await repository.change(add('ana@example.com', 'colaborador'), NOW)).toEqual({
        status: 'changed',
        roles: ['colaborador', 'usuario'],
      });

      expect(await rolesOf(userId)).toEqual(['colaborador', 'usuario']);
      const written = await logs();
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        user_id: userId,
        event_type: 'role_changed',
        success: true,
        reason: 'added_colaborador',
        ip_address: null,
        user_agent: null,
        created_at: NOW,
      });
    });

    it('does not keep the email, a token or any free text in the log', async () => {
      await person('ana@example.com');
      await repository.change(add('ana@example.com', 'colaborador'), NOW);

      const written = JSON.stringify(await logs(), (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
      expect(written).not.toContain('ana@example.com');
    });

    it('changes nothing and writes nothing when the person already has the role', async () => {
      await person('ana@example.com', ['colaborador']);

      expect(await repository.change(add('ana@example.com', 'colaborador'), NOW)).toEqual({
        status: 'unchanged',
        roles: ['colaborador', 'usuario'],
      });
      expect(await logs()).toHaveLength(0);
    });

    it('does not give a role to an account that is deactivated or deleted', async () => {
      const userId = await person('ana@example.com', [], false);

      expect(await repository.change(add('ana@example.com', 'administrador'), NOW)).toEqual({
        status: 'inactive',
      });
      expect(await rolesOf(userId)).toEqual(['usuario']);
      expect(await logs()).toHaveLength(0);
    });

    it('answers no_account for an email nobody has, and writes nothing', async () => {
      expect(await repository.change(add('nadie@example.com', 'colaborador'), NOW)).toEqual({
        status: 'no_account',
      });
      expect(await logs()).toHaveLength(0);
    });

    it('only touches the person asked for', async () => {
      await person('ana@example.com');
      const luis = await person('luis@example.com');

      await repository.change(add('ana@example.com', 'administrador'), NOW);

      expect(await rolesOf(luis)).toEqual(['usuario']);
    });
  });

  describe('removing a role', () => {
    it('removes it and writes one role_changed', async () => {
      const userId = await person('ana@example.com', ['colaborador']);

      expect(await repository.change(remove('ana@example.com', 'colaborador'), NOW)).toEqual({
        status: 'changed',
        roles: ['usuario'],
      });

      expect(await rolesOf(userId)).toEqual(['usuario']);
      expect((await logs())[0]).toMatchObject({
        user_id: userId,
        event_type: 'role_changed',
        reason: 'removed_colaborador',
      });
    });

    it('changes nothing and writes nothing when the person never had the role', async () => {
      await person('ana@example.com');

      expect(await repository.change(remove('ana@example.com', 'colaborador'), NOW)).toEqual({
        status: 'unchanged',
        roles: ['usuario'],
      });
      expect(await logs()).toHaveLength(0);
    });

    it('never takes the base role away, even if the caller asks the repository directly', async () => {
      const userId = await person('ana@example.com');

      await expect(repository.change(remove('ana@example.com', 'usuario'), NOW)).rejects.toThrow(
        'base of every account',
      );
      expect(await rolesOf(userId)).toEqual(['usuario']);
    });

    it('takes a role away from a deactivated account: that is always safe', async () => {
      const userId = await person('ana@example.com', ['colaborador'], false);

      expect((await repository.change(remove('ana@example.com', 'colaborador'), NOW)).status).toBe(
        'changed',
      );
      expect(await rolesOf(userId)).toEqual(['usuario']);
    });
  });

  describe('the last administrator', () => {
    it('is never taken away: the system keeps at least one', async () => {
      const userId = await person('ana@example.com', ['administrador']);

      expect(await repository.change(remove('ana@example.com', 'administrador'), NOW)).toEqual({
        status: 'last_administrator',
      });

      expect(await rolesOf(userId)).toEqual(['administrador', 'usuario']);
      expect(await logs()).toHaveLength(0);
    });

    it('lets one of two administrators go, and then refuses the other', async () => {
      await person('ana@example.com', ['administrador']);
      await person('luis@example.com', ['administrador']);

      expect(
        (await repository.change(remove('ana@example.com', 'administrador'), NOW)).status,
      ).toBe('changed');
      expect(
        (await repository.change(remove('luis@example.com', 'administrador'), NOW)).status,
      ).toBe('last_administrator');
      expect(await adminCount()).toBe(1);
    });

    it('does not count a deactivated administrator as one that is left', async () => {
      const ana = await person('ana@example.com', ['administrador']);
      await person('luis@example.com', ['administrador'], false);

      expect(
        (await repository.change(remove('ana@example.com', 'administrador'), NOW)).status,
      ).toBe('last_administrator');
      expect(await rolesOf(ana)).toContain('administrador');
    });

    it('lets a deactivated administrator lose the role even when it is the only other one', async () => {
      await person('ana@example.com', ['administrador']);
      const luis = await person('luis@example.com', ['administrador'], false);

      expect(
        (await repository.change(remove('luis@example.com', 'administrador'), NOW)).status,
      ).toBe('changed');
      expect(await rolesOf(luis)).toEqual(['usuario']);
    });

    it('still leaves one when two people remove the last two administrators at the same time', async () => {
      for (let round = 0; round < 6; round += 1) {
        await resetDatabase(db);
        await person('ana@example.com', ['administrador']);
        await person('luis@example.com', ['administrador']);

        const results = await Promise.all([
          repository.change(remove('ana@example.com', 'administrador'), NOW),
          repository.change(remove('luis@example.com', 'administrador'), NOW),
        ]);

        expect(results.map((result) => result.status).sort()).toEqual([
          'changed',
          'last_administrator',
        ]);
        expect(await adminCount()).toBe(1);
        expect(await logs()).toHaveLength(1);
      }
    });
  });

  describe('a change and its log', () => {
    it('go together: if the log cannot be written, the role is not changed', async () => {
      const userId = await person('ana@example.com');

      await expect(
        repository.change(add('ana@example.com', 'colaborador'), new Date('not a date')),
      ).rejects.toThrow();

      expect(await rolesOf(userId)).toEqual(['usuario']);
      expect(await logs()).toHaveLength(0);
    });
  });
});

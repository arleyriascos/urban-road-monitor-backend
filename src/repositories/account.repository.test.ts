import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AccountRepository } from './account.repository.js';

/** A database that only counts the queries it is asked and answers what the test gives it. */
function databaseAnswering(rows: unknown[]) {
  const queryRaw = vi.fn(async () => rows);
  return { db: { $queryRaw: queryRaw } as unknown as PrismaClient, queryRaw };
}

const ROW = {
  id: '5f0b3c2e-0000-4000-8000-000000000001',
  email: 'ana@example.com',
  full_name: 'Ana Pérez',
  avatar_url: 'https://lh3.example.com/a/photo=s96-c',
};

describe('AccountRepository.findProfile', () => {
  it('asks the database once and answers the person in the shape of the sign-in', async () => {
    const { db, queryRaw } = databaseAnswering([{ ...ROW, roles: ['usuario'], permissions: [] }]);

    const profile = await new AccountRepository(db).findProfile(ROW.id);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(profile).toEqual({
      id: ROW.id,
      email: 'ana@example.com',
      fullName: 'Ana Pérez',
      avatarUrl: 'https://lh3.example.com/a/photo=s96-c',
      roles: ['usuario'],
      permissions: [],
    });
  });

  it('puts the roles and the permissions in alphabetical order', async () => {
    const { db } = databaseAnswering([
      {
        ...ROW,
        roles: ['usuario', 'colaborador'],
        permissions: ['trips.view_own', 'detections.create', 'potholes.report_repair'],
      },
    ]);

    const profile = await new AccountRepository(db).findProfile(ROW.id);

    expect(profile?.roles).toEqual(['colaborador', 'usuario']);
    expect(profile?.permissions).toEqual([
      'detections.create',
      'potholes.report_repair',
      'trips.view_own',
    ]);
  });

  it('keeps a missing photo as null', async () => {
    const { db } = databaseAnswering([
      { ...ROW, avatar_url: null, roles: ['usuario'], permissions: [] },
    ]);
    expect((await new AccountRepository(db).findProfile(ROW.id))?.avatarUrl).toBeNull();
  });

  it('answers null when there is no such active account', async () => {
    const { db } = databaseAnswering([]);
    expect(await new AccountRepository(db).findProfile(ROW.id)).toBeNull();
  });
});

describe('AccountRepository.hasPermission', () => {
  it('asks the database once', async () => {
    const { db, queryRaw } = databaseAnswering([{ allowed: true }]);

    expect(await new AccountRepository(db).hasPermission(ROW.id, 'detections.create')).toBe(true);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('is false when the database says no, or says nothing', async () => {
    expect(
      await new AccountRepository(databaseAnswering([{ allowed: false }]).db).hasPermission(
        ROW.id,
        'users.manage',
      ),
    ).toBe(false);
    expect(
      await new AccountRepository(databaseAnswering([]).db).hasPermission(ROW.id, 'users.manage'),
    ).toBe(false);
  });
});

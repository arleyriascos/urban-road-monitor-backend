import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error.js';
import type { AccountProfile, AccountRepository } from '../repositories/account.repository.js';
import { AccountService } from './account.service.js';

type FindProfile = AccountRepository['findProfile'];
type HasPermission = AccountRepository['hasPermission'];

const profile: AccountProfile = {
  id: '5f0b3c2e-0000-4000-8000-000000000001',
  email: 'ana@example.com',
  fullName: 'Ana Pérez',
  avatarUrl: null,
  roles: ['colaborador', 'usuario'],
  permissions: ['detections.create'],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AccountService.profile', () => {
  it('answers what the repository finds', async () => {
    const findProfile = vi.fn<FindProfile>(async () => profile);
    const service = new AccountService({ findProfile, hasPermission: vi.fn<HasPermission>() });

    expect(await service.profile(profile.id)).toEqual(profile);
    expect(findProfile).toHaveBeenCalledWith(profile.id);
  });

  it('answers null when the account is no longer active', async () => {
    const service = new AccountService({
      findProfile: vi.fn<FindProfile>(async () => null),
      hasPermission: vi.fn<HasPermission>(),
    });
    expect(await service.profile(profile.id)).toBeNull();
  });

  it('turns a database failure into a 503, never into a null', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = new AccountService({
      findProfile: vi.fn<FindProfile>(async () => {
        throw new Error('connection refused');
      }),
      hasPermission: vi.fn<HasPermission>(),
    });

    await expect(service.profile(profile.id)).rejects.toMatchObject({
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
    });
    await expect(service.profile(profile.id)).rejects.toBeInstanceOf(AppError);
  });
});

describe('AccountService.hasPermission', () => {
  it('answers what the repository says, for the person and the code asked', async () => {
    const hasPermission = vi.fn<HasPermission>(async (_userId, code) => code === 'users.manage');
    const service = new AccountService({ findProfile: vi.fn<FindProfile>(), hasPermission });

    expect(await service.hasPermission(profile.id, 'users.manage')).toBe(true);
    expect(await service.hasPermission(profile.id, 'detections.create')).toBe(false);
    expect(hasPermission).toHaveBeenNthCalledWith(1, profile.id, 'users.manage');
  });

  it('turns a database failure into a 503, never into a "no"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = new AccountService({
      findProfile: vi.fn<FindProfile>(),
      hasPermission: vi.fn<HasPermission>(async () => {
        throw new Error('timeout');
      }),
    });

    await expect(service.hasPermission(profile.id, 'users.manage')).rejects.toMatchObject({
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
    });
  });
});

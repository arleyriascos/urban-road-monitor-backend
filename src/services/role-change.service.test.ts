import { describe, expect, it, vi } from 'vitest';
import type { RoleCommand } from '../auth/role-command.js';
import type { AccountRoles, RoleChangeOutcome } from '../repositories/role-admin.repository.js';
import { RoleChangeService, type RoleChangeStore } from './role-change.service.js';

const TARGET = { host: 'ep-dev-1.neon.tech', database: 'urban_road_monitor' };

function account(overrides: Partial<AccountRoles> = {}): AccountRoles {
  return {
    userId: 'user-1',
    email: 'ana@example.com',
    fullName: 'Ana Pérez',
    isActive: true,
    roles: ['usuario'],
    ...overrides,
  };
}

function setup(
  found: AccountRoles | null = account(),
  outcome: RoleChangeOutcome = { status: 'changed', roles: ['colaborador', 'usuario'] },
  confirmed = true,
) {
  const store = {
    describeTarget: vi.fn(() => TARGET),
    findAccount: vi.fn(async () => found),
    change: vi.fn(async () => outcome),
  } satisfies RoleChangeStore;
  const confirm = vi.fn(async () => confirmed);
  return { store, confirm, service: new RoleChangeService({ store, confirm }) };
}

const addCollaborator: RoleCommand = {
  action: 'add',
  email: 'ana@example.com',
  role: 'colaborador',
};

describe('RoleChangeService', () => {
  it('shows the database and the roles before and after, asks, and then writes', async () => {
    const { store, confirm, service } = setup();

    const result = await service.run(addCollaborator);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith({
      target: TARGET,
      command: addCollaborator,
      account: account(),
      rolesBefore: ['usuario'],
      rolesAfter: ['colaborador', 'usuario'],
    });
    expect(store.change).toHaveBeenCalledWith(addCollaborator);
    expect(result.status).toBe('changed');
    expect(result.message).toContain('ana@example.com');
    expect(result.message).toContain('colaborador, usuario');
    expect(result.message).toContain('role_changed');
  });

  it('asks BEFORE writing: the account is read first and the change comes last', async () => {
    const order: string[] = [];
    const { store, confirm, service } = setup();
    store.findAccount.mockImplementation(async () => {
      order.push('read');
      return account();
    });
    confirm.mockImplementation(async () => {
      order.push('confirm');
      return true;
    });
    store.change.mockImplementation(async () => {
      order.push('write');
      return { status: 'changed', roles: ['colaborador', 'usuario'] };
    });

    await service.run(addCollaborator);

    expect(order).toEqual(['read', 'confirm', 'write']);
  });

  it('shows the roles that would remain when one is removed', async () => {
    const { confirm, service } = setup(account({ roles: ['colaborador', 'usuario'] }), {
      status: 'changed',
      roles: ['usuario'],
    });

    await service.run({ action: 'remove', email: 'ana@example.com', role: 'colaborador' });

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ rolesBefore: ['colaborador', 'usuario'], rolesAfter: ['usuario'] }),
    );
  });

  it('writes nothing when the person does not confirm', async () => {
    const { store, service } = setup(account(), undefined, false);

    const result = await service.run(addCollaborator);

    expect(result).toEqual({ status: 'cancelled', message: 'Cancelado: no se cambió nada.' });
    expect(store.change).not.toHaveBeenCalled();
  });

  it('refuses an account that does not exist, without asking and naming the database', async () => {
    const { store, confirm, service } = setup(null);

    const result = await service.run(addCollaborator);

    expect(result.status).toBe('refused');
    expect(result.message).toContain('ana@example.com');
    expect(result.message).toContain('urban_road_monitor');
    expect(result.message).toContain('ingresar una vez con Google');
    expect(confirm).not.toHaveBeenCalled();
    expect(store.change).not.toHaveBeenCalled();
  });

  it('refuses to give a role to a deactivated account, without asking', async () => {
    const { store, confirm, service } = setup(account({ isActive: false }));

    const result = await service.run(addCollaborator);

    expect(result.status).toBe('refused');
    expect(result.message).toContain('desactivada');
    expect(confirm).not.toHaveBeenCalled();
    expect(store.change).not.toHaveBeenCalled();
  });

  it('lets a role be taken from a deactivated account, after confirming', async () => {
    const { store, confirm, service } = setup(
      account({ isActive: false, roles: ['colaborador', 'usuario'] }),
      { status: 'changed', roles: ['usuario'] },
    );

    const result = await service.run({
      action: 'remove',
      email: 'ana@example.com',
      role: 'colaborador',
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(store.change).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('changed');
  });

  it('does not ask when the person already has the role', async () => {
    const { store, confirm, service } = setup(account({ roles: ['colaborador', 'usuario'] }));

    const result = await service.run(addCollaborator);

    expect(result.status).toBe('unchanged');
    expect(result.message).toContain('ya tiene el rol colaborador');
    expect(confirm).not.toHaveBeenCalled();
    expect(store.change).not.toHaveBeenCalled();
  });

  it('does not ask when the person never had the role to remove', async () => {
    const { confirm, service } = setup();

    const result = await service.run({
      action: 'remove',
      email: 'ana@example.com',
      role: 'colaborador',
    });

    expect(result.status).toBe('unchanged');
    expect(result.message).toContain('no tiene el rol colaborador');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('explains that the last administrator cannot lose the role, and says what to do', async () => {
    const { service } = setup(account({ roles: ['administrador', 'usuario'] }), {
      status: 'last_administrator',
    });

    const result = await service.run({
      action: 'remove',
      email: 'ana@example.com',
      role: 'administrador',
    });

    expect(result.status).toBe('refused');
    expect(result.message).toContain('último administrador');
    expect(result.message).toContain('otra cuenta');
  });

  it('reports what the repository found out after the confirmation (a race lost)', async () => {
    const inactive = await setup(account(), { status: 'inactive' }).service.run(addCollaborator);
    const gone = await setup(account(), { status: 'no_account' }).service.run(addCollaborator);
    const already = await setup(account(), {
      status: 'unchanged',
      roles: ['colaborador', 'usuario'],
    }).service.run(addCollaborator);

    expect(inactive).toMatchObject({ status: 'refused' });
    expect(gone).toMatchObject({ status: 'refused' });
    expect(already).toMatchObject({ status: 'unchanged' });
  });

  it('lets a failure of the database reach the caller instead of hiding it', async () => {
    const { store, service } = setup();
    store.change.mockRejectedValueOnce(new Error('connection refused'));

    await expect(service.run(addCollaborator)).rejects.toThrow('connection refused');
  });
});

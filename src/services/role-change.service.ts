import type { RoleCommand } from '../auth/role-command.js';
import type { TargetDescription } from '../config/database-target.js';
import type { AccountRoles, RoleChangeOutcome } from '../repositories/role-admin.repository.js';

/** Where the accounts are read from and the roles written to. The real one uses PostgreSQL. */
export interface RoleChangeStore {
  describeTarget(): TargetDescription;
  findAccount(email: string): Promise<AccountRoles | null>;
  change(command: RoleCommand): Promise<RoleChangeOutcome>;
}

/** What the person sees before they are asked to confirm: nothing has been written yet. */
export interface RoleChangePreview {
  target: TargetDescription;
  command: RoleCommand;
  account: AccountRoles;
  /** The roles the person has now and the ones they would have, both in alphabetical order. */
  rolesBefore: string[];
  rolesAfter: string[];
}

export interface RoleChangeDependencies {
  store: RoleChangeStore;
  /** Shows the preview, with the database it will write to, and asks the person to confirm. */
  confirm(preview: RoleChangePreview): Promise<boolean>;
}

export type RoleChangeResult =
  /** The role was added or removed and its role_changed was written. */
  | { status: 'changed'; message: string }
  /** There was nothing to do: no question was asked and nothing was written. */
  | { status: 'unchanged'; message: string }
  /** The person did not confirm: nothing was written. */
  | { status: 'cancelled'; message: string }
  /** A rule stopped it: nothing was written. */
  | { status: 'refused'; message: string };

function rolesAfter(rolesBefore: string[], command: RoleCommand): string[] {
  const without = rolesBefore.filter((name) => name !== command.role);
  return (command.action === 'add' ? [...without, command.role] : without).sort();
}

/**
 * Gives or takes away a role, with the care that a change of permissions deserves:
 * it reads the account first, says what would change and in WHICH database, waits for the
 * confirmation, and only then writes. Nothing that cannot change anything asks a question.
 * The rules that protect the system (the base role, the last administrator, deactivated
 * accounts) are the repository's: this service only explains them.
 */
export class RoleChangeService {
  constructor(private readonly dependencies: RoleChangeDependencies) {}

  async run(command: RoleCommand): Promise<RoleChangeResult> {
    const { store, confirm } = this.dependencies;
    const target = store.describeTarget();

    const account = await store.findAccount(command.email);
    if (!account) {
      return {
        status: 'refused',
        message:
          `No hay ninguna cuenta con el correo ${command.email} en ${target.database}. ` +
          'La persona debe ingresar una vez con Google para que la cuenta exista.',
      };
    }

    const rolesBefore = [...account.roles].sort();
    const has = rolesBefore.includes(command.role);
    if (command.action === 'add' && !account.isActive) {
      return {
        status: 'refused',
        message: `La cuenta ${account.email} está desactivada: no se le dan roles.`,
      };
    }
    if ((command.action === 'add') === has) {
      return {
        status: 'unchanged',
        message:
          command.action === 'add'
            ? `${account.email} ya tiene el rol ${command.role}. No se cambió nada.`
            : `${account.email} no tiene el rol ${command.role}. No se cambió nada.`,
      };
    }

    const confirmed = await confirm({
      target,
      command,
      account,
      rolesBefore,
      rolesAfter: rolesAfter(rolesBefore, command),
    });
    if (!confirmed) {
      return { status: 'cancelled', message: 'Cancelado: no se cambió nada.' };
    }

    const outcome = await store.change(command);
    switch (outcome.status) {
      case 'changed':
        return {
          status: 'changed',
          message:
            `Listo: ${account.email} ahora tiene ${outcome.roles.join(', ')}. ` +
            'El cambio vale desde su siguiente petición y quedó anotado como role_changed.',
        };
      case 'unchanged':
        return {
          status: 'unchanged',
          message: `${account.email} ya estaba así: ${outcome.roles.join(', ')}. No se cambió nada.`,
        };
      case 'last_administrator':
        return {
          status: 'refused',
          message:
            `${account.email} es el último administrador activo: no se le quita el rol. ` +
            'Primero dale el rol administrador a otra cuenta.',
        };
      case 'inactive':
        return {
          status: 'refused',
          message: `La cuenta ${account.email} está desactivada: no se le dan roles.`,
        };
      case 'no_account':
        return {
          status: 'refused',
          message: `La cuenta ${account.email} dejó de existir mientras tanto. No se cambió nada.`,
        };
    }
  }
}

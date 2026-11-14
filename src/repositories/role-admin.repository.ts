import {
  BASE_ROLE_NAME,
  type RoleAction,
  type RoleCommand,
  type RoleName,
} from '../auth/role-command.js';
import { prisma } from '../config/database.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

/** An account as the script shows it before it asks for confirmation. */
export interface AccountRoles {
  userId: string;
  email: string;
  fullName: string;
  /** False for a deactivated or deleted account. */
  isActive: boolean;
  /** The names of their roles, in alphabetical order. */
  roles: string[];
}

export type RoleChangeOutcome =
  /** The role was added or taken away. `roles` are the ones the person has now. */
  | { status: 'changed'; roles: string[] }
  /** Nothing to do: the person already had the role (add) or never had it (remove). */
  | { status: 'unchanged'; roles: string[] }
  | { status: 'no_account' }
  /** A deactivated or deleted account is not given roles: it could not use them anyway. */
  | { status: 'inactive' }
  /** Taking the role away would leave the system without an active administrator. */
  | { status: 'last_administrator' };

const ADMINISTRATOR: RoleName = 'administrador';

/**
 * The reason written in auth_logs for a role change: "added_colaborador" or
 * "removed_administrador". It is built from the action and a role name only, so it can never
 * hold anything else, and it fits the short lowercase code that the table accepts.
 */
export function roleChangeReason(action: RoleAction, role: RoleName): string {
  return `${action === 'add' ? 'added' : 'removed'}_${role}`;
}

/** The names of the roles of a person, in alphabetical order. */
async function rolesOf(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
  const rows = await tx.user_roles.findMany({
    where: { user_id: userId },
    select: { roles: { select: { name: true } } },
  });
  return rows.map((row) => row.roles.name).sort();
}

/**
 * Gives and takes away roles. It is only used by the script npm run user:role: there is no
 * endpoint to do this, on purpose, so that nobody can promote themselves from the app.
 *
 * Each change runs in ONE transaction that also writes the role_changed row of auth_logs,
 * so a change never exists without its record. The rules that protect the system live here,
 * at the lowest level, and not only in the script:
 * - the base role is never taken away;
 * - the last active administrator is never taken away (two people removing the last two
 *   administrators at once are served one after the other: the second one is refused);
 * - a deactivated or deleted account is not given a role.
 */
export class RoleAdminRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  /** The account with that email and its roles, or null if nobody has signed in with it. */
  async findAccount(email: string): Promise<AccountRoles | null> {
    const user = await this.db.users.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        full_name: true,
        is_active: true,
        deleted_at: true,
        user_roles: { select: { roles: { select: { name: true } } } },
      },
    });
    if (!user) {
      return null;
    }
    return {
      userId: user.id,
      email: user.email,
      fullName: user.full_name,
      isActive: user.is_active && user.deleted_at === null,
      roles: user.user_roles.map((row) => row.roles.name).sort(),
    };
  }

  async change(command: RoleCommand, now: Date = new Date()): Promise<RoleChangeOutcome> {
    if (command.action === 'remove' && command.role === BASE_ROLE_NAME) {
      throw new Error(
        `The role "${BASE_ROLE_NAME}" is the base of every account: it is never removed`,
      );
    }
    return this.db.$transaction((tx) => this.apply(tx, command, now));
  }

  private async apply(
    tx: Prisma.TransactionClient,
    { action, email, role }: RoleCommand,
    now: Date,
  ): Promise<RoleChangeOutcome> {
    // Two removals of administrators at the same time must not both see "there is another
    // one left", so they queue on the row of the role. Nothing else locks that row.
    if (action === 'remove' && role === ADMINISTRATOR) {
      await tx.$queryRaw`SELECT id FROM roles WHERE name = ${ADMINISTRATOR} FOR UPDATE`;
    }

    // The row of the person is locked until the transaction ends, so the role cannot change
    // under it and a sign-in of the same person waits its turn.
    const accounts = await tx.$queryRaw<
      { id: string; is_active: boolean; deleted_at: Date | null }[]
    >`
      SELECT id, is_active, deleted_at FROM users WHERE email = ${email} FOR UPDATE`;
    const account = accounts[0];
    if (!account) {
      return { status: 'no_account' };
    }
    const active = account.is_active && account.deleted_at === null;

    const roleRow = await tx.roles.findUnique({ where: { name: role }, select: { id: true } });
    if (!roleRow) {
      throw new Error(`The role "${role}" does not exist: apply migration 08 to this database`);
    }

    const current = await rolesOf(tx, account.id);
    const has = current.includes(role);

    if (action === 'add') {
      if (!active) {
        return { status: 'inactive' };
      }
      if (has) {
        return { status: 'unchanged', roles: current };
      }
      await tx.user_roles.create({ data: { user_id: account.id, role_id: roleRow.id } });
    } else {
      if (!has) {
        return { status: 'unchanged', roles: current };
      }
      if (role === ADMINISTRATOR && active) {
        const counts = await tx.$queryRaw<{ total: number }[]>`
          SELECT COUNT(*)::int AS total
          FROM user_roles ur
          JOIN users u ON u.id = ur.user_id
          WHERE ur.role_id = ${roleRow.id} AND u.is_active AND u.deleted_at IS NULL`;
        if ((counts[0]?.total ?? 0) <= 1) {
          return { status: 'last_administrator' };
        }
      }
      await tx.user_roles.delete({
        where: { user_id_role_id: { user_id: account.id, role_id: roleRow.id } },
      });
    }

    await tx.auth_logs.create({
      data: {
        user_id: account.id,
        event_type: 'role_changed',
        success: true,
        reason: roleChangeReason(action, role),
        created_at: now,
      },
    });
    return { status: 'changed', roles: await rolesOf(tx, account.id) };
  }
}

export const roleAdminRepository = new RoleAdminRepository();

import { prisma } from '../config/database.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { isUniqueViolation } from './prisma-errors.js';
import { BASE_ROLE, MissingBaseRoleError, type AuthUser } from './user.repository.js';

/** What it takes to make an account with a password. The email is already in lowercase. */
export interface NewPasswordAccount {
  email: string;
  fullName: string;
  /** The scrypt hash, never the password. */
  passwordHash: string;
  now: Date;
}

export type RegisterOutcome =
  | { kind: 'created'; user: AuthUser }
  /** An account (of any kind, active or not) already has that email. Nothing was changed. */
  | { kind: 'email_taken' };

/** The account behind an email, with the hash to check the password against. */
export interface PasswordLoginRecord {
  user: AuthUser;
  passwordHash: string;
  /** False for a deactivated or deleted account. */
  isActive: boolean;
}

const USER_FIELDS = {
  id: true,
  email: true,
  full_name: true,
  avatar_url: true,
  is_active: true,
  deleted_at: true,
} as const;

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
}

/**
 * The accounts of the people who sign in with an email and a password: making one, finding
 * one to check a password, and changing the password. The hashing is done by the caller; this
 * class only stores and reads hashes.
 */
export class PasswordAccountRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Makes the account in ONE transaction: the user (email not verified yet), its password and
   * the base role. If two registrations of the same email collide, the unique key makes the
   * second one answer "email_taken".
   */
  async register(input: NewPasswordAccount): Promise<RegisterOutcome> {
    try {
      return await this.db.$transaction(async (tx) => {
        const role = await tx.roles.findUnique({
          where: { name: BASE_ROLE },
          select: { id: true },
        });
        if (!role) {
          throw new MissingBaseRoleError();
        }
        const created = await tx.users.create({
          data: {
            email: input.email,
            full_name: input.fullName,
            last_login_at: input.now,
            password_credentials: { create: { password_hash: input.passwordHash } },
            user_roles: { create: { role_id: role.id } },
          },
          select: USER_FIELDS,
        });
        return { kind: 'created' as const, user: await this.withRoles(tx, created) };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { kind: 'email_taken' };
      }
      throw error;
    }
  }

  /** The account with that email and a password, or null if there is none (a Google-only one too). */
  async findForLogin(email: string): Promise<PasswordLoginRecord | null> {
    const row = await this.db.users.findUnique({
      where: { email },
      select: { ...USER_FIELDS, password_credentials: { select: { password_hash: true } } },
    });
    if (!row?.password_credentials) {
      return null;
    }
    return {
      user: await this.withRoles(this.db, row),
      passwordHash: row.password_credentials.password_hash,
      isActive: row.is_active && row.deleted_at === null,
    };
  }

  /** Writes the time of the last sign-in. */
  async touchLogin(userId: string, now: Date): Promise<void> {
    await this.db.users.update({ where: { id: userId }, data: { last_login_at: now } });
  }

  /** The hash of the password of an active account, or null if it has none. */
  async findHash(userId: string): Promise<string | null> {
    const row = await this.db.password_credentials.findFirst({
      where: { user_id: userId, users: { is_active: true, deleted_at: null } },
      select: { password_hash: true },
    });
    return row?.password_hash ?? null;
  }

  /**
   * Replaces the hash and closes every session of the person except `keepSessionId`, all in
   * one transaction. It answers how many sessions it closed, or null if the account has no
   * password to change (nothing is touched then).
   */
  async changePassword(input: {
    userId: string;
    passwordHash: string;
    keepSessionId: string;
    now: Date;
  }): Promise<number | null> {
    return this.db.$transaction(async (tx) => {
      const changed = await tx.password_credentials.updateMany({
        where: { user_id: input.userId },
        data: { password_hash: input.passwordHash },
      });
      if (changed.count === 0) {
        return null;
      }
      const closed = await tx.sessions.updateMany({
        where: { user_id: input.userId, id: { not: input.keepSessionId }, revoked_at: null },
        data: { revoked_at: input.now },
      });
      return closed.count;
    });
  }

  private async withRoles(
    db: PrismaClient | Prisma.TransactionClient,
    account: UserRow,
  ): Promise<AuthUser> {
    const rows = await db.user_roles.findMany({
      where: { user_id: account.id },
      select: { roles: { select: { name: true } } },
    });
    return {
      id: account.id,
      email: account.email,
      fullName: account.full_name,
      avatarUrl: account.avatar_url,
      roles: rows.map((row) => row.roles.name).sort(),
    };
  }
}

export const passwordAccountRepository = new PasswordAccountRepository();

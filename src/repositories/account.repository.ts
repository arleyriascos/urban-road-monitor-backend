import { prisma } from '../config/database.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AuthUser } from './user.repository.js';

/** The person as GET /api/auth/me shows them: what the sign-in gave, plus what they may do. */
export interface AccountProfile extends AuthUser {
  /** The permission codes their roles grant, in alphabetical order (detections.create...). */
  permissions: string[];
}

interface RawProfileRow {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  roles: string[];
  permissions: string[];
}

/**
 * Reads who a person is and what they may do. Each question is ONE query, because they run
 * on requests that already paid for the session check: the profile for GET /api/auth/me and
 * the permission for requirePermission.
 *
 * Roles and permissions are never copied into the session: they are read from the tables on
 * every request, so promoting or demoting somebody (npm run user:role) takes effect on their
 * very next request.
 */
export class AccountRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * The person with their roles and permissions, or null if the account does not exist or is
   * deactivated or deleted. The roles and the permissions come in alphabetical order.
   */
  async findProfile(userId: string): Promise<AccountProfile | null> {
    const rows = await this.db.$queryRaw<RawProfileRow[]>`
      SELECT u.id, u.email, u.full_name, u.avatar_url,
             ARRAY(
               SELECT DISTINCT r.name::text
               FROM user_roles ur
               JOIN roles r ON r.id = ur.role_id
               WHERE ur.user_id = u.id
             ) AS roles,
             ARRAY(
               SELECT DISTINCT p.code::text
               FROM user_roles ur
               JOIN role_permissions rp ON rp.role_id = ur.role_id
               JOIN permissions p ON p.id = rp.permission_id
               WHERE ur.user_id = u.id
             ) AS permissions
      FROM users u
      WHERE u.id = ${userId}::uuid AND u.is_active AND u.deleted_at IS NULL`;
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      avatarUrl: row.avatar_url,
      roles: [...row.roles].sort(),
      permissions: [...row.permissions].sort(),
    };
  }

  /** Whether an active person has a role that grants the permission code. */
  async hasPermission(userId: string, code: string): Promise<boolean> {
    const rows = await this.db.$queryRaw<{ allowed: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM users u
        JOIN user_roles ur ON ur.user_id = u.id
        JOIN role_permissions rp ON rp.role_id = ur.role_id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE u.id = ${userId}::uuid
          AND u.is_active AND u.deleted_at IS NULL
          AND p.code = ${code}
      ) AS allowed`;
    return rows[0]?.allowed === true;
  }
}

export const accountRepository = new AccountRepository();

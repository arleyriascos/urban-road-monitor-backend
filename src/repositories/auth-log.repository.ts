import { anonymizeIp, trimUserAgent } from '../auth/privacy.js';
import { prisma } from '../config/database.js';
import type { PrismaClient } from '../generated/prisma/client.js';

/** The event types the auth_logs table accepts (see migration 08). */
export type AuthEventType =
  | 'login'
  | 'logout'
  | 'login_failed'
  | 'token_refresh'
  | 'session_rejected'
  | 'role_changed'
  | 'register'
  | 'email_verified'
  | 'password_changed'
  | 'password_reset'
  | 'account_linked'
  | 'account_deleted';

export interface AuthLogEntry {
  /** Null when the person is not known, as in a failed login with an invalid token. */
  userId?: string | null;
  eventType: AuthEventType;
  success: boolean;
  userAgent?: string | null;
  /** The real address of the client. It is cut before it is kept, and only for failures. */
  ip?: string | null;
  /** Why it failed, for example "expired". Lowercase letters and underscores only. */
  reason?: string | null;
  /** The time of the event; the current time when it is not given. */
  now?: Date;
}

/** A reason is a short code: it can never hold an email, a token or any free text. */
const REASON_FORMAT = /^[a-z][a-z_]{0,39}$/;

/**
 * Writes the audit log of the sign-ins. What it keeps is decided here, in one place:
 * - the user agent is cut to 255 characters;
 * - the IP address is kept only for failures, and with its last part cut off;
 * - the reason is a short code, never free text;
 * - tokens and emails have no column to go to.
 */
export class AuthLogRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async record(entry: AuthLogEntry): Promise<void> {
    if (entry.reason != null && !REASON_FORMAT.test(entry.reason)) {
      throw new Error('The reason of an auth log must be a short lowercase code');
    }
    await this.db.auth_logs.create({
      data: {
        user_id: entry.userId ?? null,
        event_type: entry.eventType,
        success: entry.success,
        user_agent: trimUserAgent(entry.userAgent),
        ip_address: entry.success ? null : anonymizeIp(entry.ip),
        reason: entry.reason ?? null,
        created_at: entry.now ?? new Date(),
      },
    });
  }
}

export const authLogRepository = new AuthLogRepository();

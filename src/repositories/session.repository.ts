import { MAX_SESSIONS_PER_USER, initialExpiry, renewedExpiry } from '../auth/session-config.js';
import { prisma } from '../config/database.js';
import type { PrismaClient } from '../generated/prisma/client.js';

/** What it takes to open a session. `now` is passed in so tests can control the clock. */
export interface NewSession {
  userId: string;
  /** SHA-256 of the session identifier; the identifier itself is never stored. */
  tokenHash: string;
  userAgent: string | null;
  now: Date;
}

export interface OpenedSession {
  id: string;
  expiresAt: Date;
}

/** A session found by its hash, with what is needed to decide whether it still works. */
export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  userIsActive: boolean;
  userDeletedAt: Date | null;
  email: string;
  fullName: string;
}

interface RawSessionRow {
  id: string;
  user_id: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  is_active: boolean;
  deleted_at: Date | null;
  email: string;
  full_name: string;
}

/** Reads and writes the sessions table. Every time comes from the caller, never from NOW(). */
export class SessionRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Opens a session in one transaction:
   * 1. locks the user's row, so two logins of the same person run one after the other;
   * 2. deletes that person's sessions that already expired or were revoked;
   * 3. if they still have 5 open, revokes the one that expires first (the least used,
   *    because every use pushes the expiry forward);
   * 4. inserts the new one.
   * Other people's sessions are never touched.
   */
  async open({ userId, tokenHash, userAgent, now }: NewSession): Promise<OpenedSession> {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;

      await tx.sessions.deleteMany({
        where: {
          user_id: userId,
          OR: [{ revoked_at: { not: null } }, { expires_at: { lte: now } }],
        },
      });

      const open = await tx.sessions.findMany({
        where: { user_id: userId, revoked_at: null, expires_at: { gt: now } },
        orderBy: [{ expires_at: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      const excess = open.length - MAX_SESSIONS_PER_USER + 1;
      if (excess > 0) {
        await tx.sessions.updateMany({
          where: { id: { in: open.slice(0, excess).map((session) => session.id) } },
          data: { revoked_at: now },
        });
      }

      const created = await tx.sessions.create({
        data: {
          user_id: userId,
          token_hash: tokenHash,
          user_agent: userAgent,
          created_at: now,
          expires_at: initialExpiry(now),
        },
        select: { id: true, expires_at: true },
      });
      return { id: created.id, expiresAt: created.expires_at };
    });
  }

  /**
   * One query finds the session by its hash and joins its user, so the caller can check the
   * expiry, the revocation and whether the person is still active without a second trip.
   * It returns the row even when the session no longer works: the caller decides why.
   */
  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const rows = await this.db.$queryRaw<RawSessionRow[]>`
      SELECT s.id, s.user_id, s.created_at, s.expires_at, s.revoked_at,
             u.is_active, u.deleted_at, u.email, u.full_name
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ${tokenHash}`;
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      userId: row.user_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      userIsActive: row.is_active,
      userDeletedAt: row.deleted_at,
      email: row.email,
      fullName: row.full_name,
    };
  }

  /**
   * Pushes the expiry forward (7 days from `now`, never past 30 days after the session was
   * created). It only writes if that really moves the expiry later, and never on a revoked
   * session. Returns whether it wrote.
   */
  async renew(sessionId: string, createdAt: Date, now: Date): Promise<boolean> {
    const expiresAt = renewedExpiry(createdAt, now);
    const result = await this.db.sessions.updateMany({
      where: { id: sessionId, revoked_at: null, expires_at: { lt: expiresAt } },
      data: { expires_at: expiresAt },
    });
    return result.count > 0;
  }

  /** Marks the session as revoked. The row stays; the next login of that person deletes it. */
  async revoke(sessionId: string, now: Date): Promise<boolean> {
    const result = await this.db.sessions.updateMany({
      where: { id: sessionId, revoked_at: null },
      data: { revoked_at: now },
    });
    return result.count > 0;
  }
}

export const sessionRepository = new SessionRepository();

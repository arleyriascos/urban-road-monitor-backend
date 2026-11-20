import { prisma } from '../config/database.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { EmailTokenPurpose } from '../auth/email-token.js';

/** The account behind a token that can still be used. */
export interface UsableEmailToken {
  tokenId: string;
  userId: string;
  email: string;
  /** False for a deactivated or deleted account. */
  isActive: boolean;
  hasPassword: boolean;
  emailVerified: boolean;
}

/** What the person is, as far as the e-mail links care. */
export interface EmailAccountState {
  email: string;
  isActive: boolean;
  emailVerified: boolean;
  hasPassword: boolean;
}

/** Thrown inside a transaction to undo it when the token was already taken by someone else. */
class TokenTaken extends Error {}

/**
 * The one-use links sent by e-mail. It stores the hash of each token, never the token. Using a
 * token and what it unlocks always happen in ONE transaction, and the token is claimed with a
 * conditional update, so two requests with the same link cannot both win.
 */
export class EmailTokenRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Stores a new token. The person's earlier links of the same purpose that were not used stop
   * working, so only the latest e-mail is valid.
   */
  async issue(input: {
    userId: string;
    purpose: EmailTokenPurpose;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<void> {
    await this.db.$transaction([
      this.db.email_tokens.updateMany({
        where: { user_id: input.userId, purpose: input.purpose, used_at: null },
        data: { used_at: input.now },
      }),
      this.db.email_tokens.create({
        data: {
          user_id: input.userId,
          purpose: input.purpose,
          token_hash: input.tokenHash,
          expires_at: input.expiresAt,
          created_at: input.now,
        },
      }),
    ]);
  }

  /** The account of a token that exists, has not been used and has not expired; otherwise null. */
  async findUsable(
    purpose: EmailTokenPurpose,
    tokenHash: string,
    now: Date,
  ): Promise<UsableEmailToken | null> {
    const row = await this.db.email_tokens.findFirst({
      where: { purpose, token_hash: tokenHash, used_at: null, expires_at: { gt: now } },
      select: {
        id: true,
        user_id: true,
        users: {
          select: {
            email: true,
            is_active: true,
            deleted_at: true,
            email_verified_at: true,
            password_credentials: { select: { user_id: true } },
          },
        },
      },
    });
    if (!row) {
      return null;
    }
    return {
      tokenId: row.id,
      userId: row.user_id,
      email: row.users.email,
      isActive: row.users.is_active && row.users.deleted_at === null,
      hasPassword: row.users.password_credentials !== null,
      emailVerified: row.users.email_verified_at !== null,
    };
  }

  /** The state of an account, or null if there is no such account. */
  async accountState(userId: string): Promise<EmailAccountState | null> {
    const row = await this.db.users.findUnique({
      where: { id: userId },
      select: {
        email: true,
        is_active: true,
        deleted_at: true,
        email_verified_at: true,
        password_credentials: { select: { user_id: true } },
      },
    });
    if (!row) {
      return null;
    }
    return {
      email: row.email,
      isActive: row.is_active && row.deleted_at === null,
      emailVerified: row.email_verified_at !== null,
      hasPassword: row.password_credentials !== null,
    };
  }

  /**
   * Uses a verification token: marks it used and the email as verified, together. It answers
   * false, changing nothing, if somebody used the token first.
   */
  async verifyEmail(input: { tokenId: string; userId: string; now: Date }): Promise<boolean> {
    try {
      return await this.db.$transaction(async (tx) => {
        await this.claim(tx, input.tokenId, input.now);
        await tx.users.updateMany({
          where: { id: input.userId, email_verified_at: null },
          data: { email_verified_at: input.now },
        });
        return true;
      });
    } catch (error) {
      if (error instanceof TokenTaken) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Uses a recovery token: marks it used, replaces the password, closes EVERY session of the
   * person (this one included: nobody is signed in by a recovery), verifies the email (the
   * person just proved they read that inbox) and cancels any other recovery link. All together,
   * or nothing. It answers how many sessions it closed, or null, changing nothing, if somebody
   * used the token first or the account has no password to replace.
   */
  async resetPassword(input: {
    tokenId: string;
    userId: string;
    passwordHash: string;
    now: Date;
  }): Promise<number | null> {
    try {
      return await this.db.$transaction(async (tx) => {
        await this.claim(tx, input.tokenId, input.now);
        const changed = await tx.password_credentials.updateMany({
          where: { user_id: input.userId },
          data: { password_hash: input.passwordHash },
        });
        if (changed.count === 0) {
          throw new TokenTaken();
        }
        const closed = await tx.sessions.updateMany({
          where: { user_id: input.userId, revoked_at: null },
          data: { revoked_at: input.now },
        });
        await tx.users.updateMany({
          where: { id: input.userId, email_verified_at: null },
          data: { email_verified_at: input.now },
        });
        await tx.email_tokens.updateMany({
          where: { user_id: input.userId, purpose: 'reset_password', used_at: null },
          data: { used_at: input.now },
        });
        return closed.count;
      });
    } catch (error) {
      if (error instanceof TokenTaken) {
        return null;
      }
      throw error;
    }
  }

  /** Takes the token for this transaction; it throws TokenTaken if it is no longer free. */
  private async claim(
    tx: Pick<PrismaClient, 'email_tokens'>,
    tokenId: string,
    now: Date,
  ): Promise<void> {
    const claimed = await tx.email_tokens.updateMany({
      where: { id: tokenId, used_at: null, expires_at: { gt: now } },
      data: { used_at: now },
    });
    if (claimed.count !== 1) {
      throw new TokenTaken();
    }
  }
}

export const emailTokenRepository = new EmailTokenRepository();

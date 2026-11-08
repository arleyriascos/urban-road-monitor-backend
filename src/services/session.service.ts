import { trimUserAgent } from '../auth/privacy.js';
import { isDueForRenewal } from '../auth/session-config.js';
import {
  generateSessionToken,
  hashSessionToken,
  isWellFormedSessionToken,
} from '../auth/session-token.js';
import { AppError } from '../errors/app-error.js';
import { authLogRepository, type AuthLogRepository } from '../repositories/auth-log.repository.js';
import {
  sessionRepository,
  type SessionRecord,
  type SessionRepository,
} from '../repositories/session.repository.js';

/** Who a valid session belongs to. */
export interface AuthContext {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
}

/** Why a session that exists does not work. A hash nobody has is not here: it is not logged. */
export type SessionRejection = 'expired' | 'revoked' | 'user_inactive';

export interface RequestContext {
  userAgent?: string | undefined;
  /** The client address; the log keeps it cut, and only for the rejection. */
  ip?: string | undefined;
}

export interface OpenedSessionToken {
  /** The session identifier. It is shown once, now: only its hash is stored. */
  token: string;
  sessionId: string;
  expiresAt: Date;
}

function databaseUnavailable(): AppError {
  return new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not available right now');
}

/**
 * Opens, checks and closes sessions.
 *
 * Checking a session answers either a person or null, and null means one thing to the
 * caller: 401. The reason it failed only goes to the audit log. If the database does not
 * answer, it throws a 503 instead, because "I could not check" is not "this session is
 * wrong": the frontend keeps the session on a 503 and only drops it on a 401.
 */
export class SessionService {
  constructor(
    private readonly sessions: Pick<
      SessionRepository,
      'open' | 'findByTokenHash' | 'renew' | 'revoke'
    > = sessionRepository,
    private readonly logs: Pick<AuthLogRepository, 'record'> = authLogRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Opens a session for a person who just proved who they are. */
  async open(userId: string, userAgent?: string): Promise<OpenedSessionToken> {
    const token = generateSessionToken();
    try {
      const opened = await this.sessions.open({
        userId,
        tokenHash: hashSessionToken(token),
        userAgent: trimUserAgent(userAgent),
        now: this.now(),
      });
      return { token, sessionId: opened.id, expiresAt: opened.expiresAt };
    } catch (error) {
      console.error('Could not open a session:', error);
      throw databaseUnavailable();
    }
  }

  /** The person behind a session identifier, or null if it does not work. */
  async authenticate(token: string, request: RequestContext = {}): Promise<AuthContext | null> {
    if (!isWellFormedSessionToken(token)) {
      return null;
    }

    let record: SessionRecord | null;
    try {
      record = await this.sessions.findByTokenHash(hashSessionToken(token));
    } catch (error) {
      console.error('Could not check a session:', error);
      throw databaseUnavailable();
    }
    if (!record) {
      return null;
    }

    const now = this.now();
    const rejection = rejectionOf(record, now);
    if (rejection) {
      await this.logRejection(record, rejection, request);
      return null;
    }

    if (isDueForRenewal(record.expiresAt, now)) {
      try {
        await this.sessions.renew(record.id, record.createdAt, now);
      } catch (error) {
        // The session is valid: not being able to extend it must not log the person out.
        console.error('Could not renew a session:', error);
      }
    }

    return {
      sessionId: record.id,
      userId: record.userId,
      email: record.email,
      fullName: record.fullName,
    };
  }

  /** Closes a session. It stays in the table, revoked, until the person's next login. */
  async revoke(sessionId: string): Promise<boolean> {
    try {
      return await this.sessions.revoke(sessionId, this.now());
    } catch (error) {
      console.error('Could not revoke a session:', error);
      throw databaseUnavailable();
    }
  }

  private async logRejection(
    record: SessionRecord,
    reason: SessionRejection,
    request: RequestContext,
  ): Promise<void> {
    try {
      await this.logs.record({
        userId: record.userId,
        eventType: 'session_rejected',
        success: false,
        userAgent: request.userAgent,
        ip: request.ip,
        reason,
        now: this.now(),
      });
    } catch (error) {
      console.error('Could not write the auth log:', error);
    }
  }
}

/** Why the session does not work, or null if it does. Revoked wins over expired. */
function rejectionOf(record: SessionRecord, now: Date): SessionRejection | null {
  if (record.revokedAt) {
    return 'revoked';
  }
  if (record.expiresAt.getTime() <= now.getTime()) {
    return 'expired';
  }
  if (!record.userIsActive || record.userDeletedAt) {
    return 'user_inactive';
  }
  return null;
}

export const sessionService = new SessionService();

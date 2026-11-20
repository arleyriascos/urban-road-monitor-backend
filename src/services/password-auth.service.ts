import { hashPassword, verifyAgainstNothing, verifyPassword } from '../auth/password-hash.js';
import {
  passwordProblem,
  passwordProblemMessage,
  type PasswordProblem,
} from '../auth/password-rules.js';
import { cleanName } from '../auth/profile-rules.js';
import { AppError } from '../errors/app-error.js';
import {
  authLogRepository,
  type AuthEventType,
  type AuthLogRepository,
} from '../repositories/auth-log.repository.js';
import {
  passwordAccountRepository,
  type PasswordAccountRepository,
} from '../repositories/password-account.repository.js';
import type { AuthUser } from '../repositories/user.repository.js';
import { sessionService, type RequestContext, type SessionService } from './session.service.js';

export interface PasswordLoginResult {
  /** The session identifier. It is shown once, now: only its hash is stored. */
  token: string;
  expiresAt: Date;
  user: AuthUser;
}

/** Why a sign-in failed, as the short code that goes to auth_logs and never to the client. */
export type PasswordLoginFailure = 'unknown_account' | 'wrong_password' | 'user_inactive';

function databaseUnavailable(): AppError {
  return new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not available right now');
}

/** The one answer for every failed sign-in: it never says which half was wrong. */
function invalidCredentials(): AppError {
  return new AppError(401, 'INVALID_CREDENTIALS', 'The email or the password is not correct');
}

function invalidPassword(problem: PasswordProblem | 'same_as_current'): AppError {
  return new AppError(
    400,
    'INVALID_PASSWORD',
    problem === 'same_as_current'
      ? 'The new password must be different from the current one'
      : passwordProblemMessage(problem),
    { problem },
  );
}

/** The email as the users table keeps it: no spaces around, lowercase. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Accounts with an email and a password: creating one, signing in, and changing the password.
 *
 * - A failed sign-in always answers the same 401, whatever failed (no such email, wrong
 *   password, deactivated account). The password is checked BEFORE the state of the account,
 *   and an unknown email spends the same time as a wrong password, so neither the answer nor
 *   the time says whether an email has an account. The real reason only goes to auth_logs.
 * - An account made here starts with the email NOT verified; Google or the e-mail
 *   verification are what verify it.
 * - The audit log never stops anything: if it cannot be written, the person still gets in.
 *   It keeps no password, no hash and no email.
 */
export class PasswordAuthService {
  constructor(
    private readonly accounts: Pick<
      PasswordAccountRepository,
      'register' | 'findForLogin' | 'touchLogin' | 'findHash' | 'changePassword'
    > = passwordAccountRepository,
    private readonly sessions: Pick<SessionService, 'open'> = sessionService,
    private readonly logs: Pick<AuthLogRepository, 'record'> = authLogRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async register(
    input: { name: string; email: string; password: string },
    request: RequestContext = {},
  ): Promise<PasswordLoginResult> {
    const email = normalizeEmail(input.email);
    const fullName = cleanName(input.name);
    if (!fullName) {
      throw new AppError(400, 'INVALID_REQUEST', 'name: the name must not be empty');
    }
    const problem = passwordProblem(input.password, email);
    if (problem) {
      throw invalidPassword(problem);
    }

    const passwordHash = await hashPassword(input.password);
    let outcome;
    try {
      outcome = await this.accounts.register({ email, fullName, passwordHash, now: this.now() });
    } catch (error) {
      console.error('Could not register an account:', error);
      throw databaseUnavailable();
    }
    if (outcome.kind === 'email_taken') {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with that email already exists');
    }

    const { user } = outcome;
    await this.succeed('register', user.id, request);
    const opened = await this.sessions.open(user.id, request.userAgent);
    await this.succeed('login', user.id, request);
    return { token: opened.token, expiresAt: opened.expiresAt, user };
  }

  async login(
    input: { email: string; password: string },
    request: RequestContext = {},
  ): Promise<PasswordLoginResult> {
    let record;
    try {
      record = await this.accounts.findForLogin(normalizeEmail(input.email));
    } catch (error) {
      console.error('Could not look up an account:', error);
      throw databaseUnavailable();
    }

    if (!record) {
      await verifyAgainstNothing(input.password);
      await this.fail('unknown_account', request);
      throw invalidCredentials();
    }
    if (!(await verifyPassword(input.password, record.passwordHash))) {
      await this.fail('wrong_password', request, record.user.id);
      throw invalidCredentials();
    }
    if (!record.isActive) {
      await this.fail('user_inactive', request, record.user.id);
      throw invalidCredentials();
    }

    try {
      await this.accounts.touchLogin(record.user.id, this.now());
    } catch (error) {
      console.error('Could not write the last sign-in:', error);
      throw databaseUnavailable();
    }
    const opened = await this.sessions.open(record.user.id, request.userAgent);
    await this.succeed('login', record.user.id, request);
    return { token: opened.token, expiresAt: opened.expiresAt, user: record.user };
  }

  /**
   * Changes the password of the person of a session. The current one must be right. Every other
   * session of the person is closed; the one that made the request stays. It answers how many
   * sessions it closed.
   */
  async changePassword(
    session: { userId: string; sessionId: string; email: string },
    input: { currentPassword: string; newPassword: string },
    request: RequestContext = {},
  ): Promise<number> {
    let stored;
    try {
      stored = await this.accounts.findHash(session.userId);
    } catch (error) {
      console.error('Could not read a password:', error);
      throw databaseUnavailable();
    }
    if (!stored) {
      throw new AppError(
        409,
        'NO_PASSWORD_SET',
        'This account has no password: it signs in with Google',
      );
    }
    if (!(await verifyPassword(input.currentPassword, stored))) {
      await this.fail('wrong_password', request, session.userId, 'password_changed');
      // 403 and not 401: a 401 makes the frontend drop a session that is perfectly good.
      throw new AppError(403, 'INVALID_CURRENT_PASSWORD', 'The current password is not correct');
    }
    if (input.newPassword === input.currentPassword) {
      throw invalidPassword('same_as_current');
    }
    const problem = passwordProblem(input.newPassword, session.email);
    if (problem) {
      throw invalidPassword(problem);
    }

    const passwordHash = await hashPassword(input.newPassword);
    let closed;
    try {
      closed = await this.accounts.changePassword({
        userId: session.userId,
        passwordHash,
        keepSessionId: session.sessionId,
        now: this.now(),
      });
    } catch (error) {
      console.error('Could not change a password:', error);
      throw databaseUnavailable();
    }
    if (closed === null) {
      throw new AppError(409, 'NO_PASSWORD_SET', 'This account has no password');
    }
    await this.succeed('password_changed', session.userId, request);
    return closed;
  }

  private async succeed(
    eventType: AuthEventType,
    userId: string,
    request: RequestContext,
  ): Promise<void> {
    await this.record({
      userId,
      eventType,
      success: true,
      userAgent: request.userAgent,
      now: this.now(),
    });
  }

  private async fail(
    reason: PasswordLoginFailure,
    request: RequestContext,
    userId: string | null = null,
    eventType: AuthEventType = 'login_failed',
  ): Promise<void> {
    await this.record({
      userId,
      eventType,
      success: false,
      userAgent: request.userAgent,
      ip: request.ip,
      reason,
      now: this.now(),
    });
  }

  private async record(entry: Parameters<AuthLogRepository['record']>[0]): Promise<void> {
    try {
      await this.logs.record(entry);
    } catch (error) {
      console.error('Could not write the auth log:', error);
    }
  }
}

export const passwordAuthService = new PasswordAuthService();

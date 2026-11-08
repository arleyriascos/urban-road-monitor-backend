import { checkGoogleIdentity, type GoogleIdentityRejection } from '../auth/google-identity.js';
import {
  GoogleAuthLibraryVerifier,
  GoogleUnavailableError,
  InvalidGoogleTokenError,
  type GoogleTokenVerifier,
} from '../auth/google-token-verifier.js';
import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import {
  authLogRepository,
  type AuthEventType,
  type AuthLogRepository,
} from '../repositories/auth-log.repository.js';
import {
  userRepository,
  type AuthUser,
  type UserRepository,
} from '../repositories/user.repository.js';
import { sessionService, type RequestContext, type SessionService } from './session.service.js';

export interface GoogleLoginResult {
  /** The session identifier. It is shown once, now: only its hash is stored. */
  token: string;
  expiresAt: Date;
  user: AuthUser;
}

/** Why a sign-in failed, as the short code that goes to auth_logs and never to the client. */
export type GoogleLoginFailure =
  GoogleIdentityRejection | 'user_inactive' | 'provider_unavailable' | 'email_conflict';

function invalidToken(): AppError {
  return new AppError(401, 'INVALID_GOOGLE_TOKEN', 'The Google sign-in could not be verified');
}

function accountDisabled(): AppError {
  return new AppError(403, 'ACCOUNT_DISABLED', 'This account is disabled');
}

function providerUnavailable(): AppError {
  return new AppError(
    503,
    'AUTH_PROVIDER_UNAVAILABLE',
    'Google could not be reached to check the sign-in, try again in a moment',
  );
}

function databaseUnavailable(): AppError {
  return new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not available right now');
}

/**
 * Signs a person in with the ID token that Google's button gave the frontend.
 *
 * The order is: check the token (signature, audience, expiry), check who it identifies (the
 * email must be verified, the token fresh), find or make the account, open the session, and
 * write the audit log. Every failure of the token answers the same 401, whatever the reason:
 * the real reason only goes to auth_logs, so the answer teaches nothing to someone testing
 * stolen or forged tokens.
 *
 * The audit log never stops a sign-in: if it cannot be written, the person still gets in.
 * It keeps no token and no email, and the address of the client only on failures.
 */
export class GoogleLoginService {
  constructor(
    /** Null when GOOGLE_CLIENT_ID is not set: the service then answers 503 and nothing else. */
    private readonly verifier: GoogleTokenVerifier | null,
    private readonly users: Pick<UserRepository, 'signInWithGoogle'> = userRepository,
    private readonly sessions: Pick<SessionService, 'open'> = sessionService,
    private readonly logs: Pick<AuthLogRepository, 'record'> = authLogRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get isConfigured(): boolean {
    return this.verifier !== null;
  }

  async login(credential: string, request: RequestContext = {}): Promise<GoogleLoginResult> {
    if (!this.verifier) {
      throw new AppError(
        503,
        'AUTH_NOT_CONFIGURED',
        'Google sign-in is not configured on this server',
      );
    }

    let claims;
    try {
      claims = await this.verifier.verify(credential);
    } catch (error) {
      if (error instanceof GoogleUnavailableError) {
        await this.fail('provider_unavailable', request);
        throw providerUnavailable();
      }
      if (error instanceof InvalidGoogleTokenError) {
        await this.fail('invalid_token', request);
        throw invalidToken();
      }
      throw error;
    }

    const checked = checkGoogleIdentity(claims, this.now());
    if (!checked.ok) {
      await this.fail(checked.reason, request);
      throw invalidToken();
    }
    const { identity } = checked;

    let outcome;
    try {
      outcome = await this.users.signInWithGoogle({
        subject: identity.subject,
        email: identity.email,
        name: identity.name,
        picture: identity.picture,
        now: this.now(),
      });
    } catch (error) {
      console.error('Could not sign in with Google:', error);
      throw databaseUnavailable();
    }

    if (outcome.kind === 'inactive') {
      await this.fail('user_inactive', request, outcome.userId);
      throw accountDisabled();
    }
    if (outcome.kind === 'email_conflict') {
      await this.fail('email_conflict', request);
      throw invalidToken();
    }

    const { user } = outcome;
    if (outcome.created) {
      await this.succeed('register', user.id, request);
    } else if (outcome.linked) {
      await this.succeed('account_linked', user.id, request);
    }

    const opened = await this.sessions.open(user.id, request.userAgent);
    await this.succeed('login', user.id, request);

    return { token: opened.token, expiresAt: opened.expiresAt, user };
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
    reason: GoogleLoginFailure,
    request: RequestContext,
    userId: string | null = null,
  ): Promise<void> {
    await this.record({
      userId,
      eventType: 'login_failed',
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

export const googleLoginService = new GoogleLoginService(
  env.GOOGLE_CLIENT_ID ? new GoogleAuthLibraryVerifier(env.GOOGLE_CLIENT_ID) : null,
);

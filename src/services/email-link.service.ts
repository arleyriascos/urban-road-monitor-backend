import { hashPassword } from '../auth/password-hash.js';
import {
  passwordProblem,
  passwordProblemMessage,
  type PasswordProblem,
} from '../auth/password-rules.js';
import {
  EMAIL_TOKEN_TTL_MS,
  generateEmailToken,
  hashEmailToken,
  isWellFormedEmailToken,
  type EmailTokenPurpose,
} from '../auth/email-token.js';
import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { createMailSetup, type MailSetup } from '../mail/mail-setup.js';
import { resetMessage, verificationMessage } from '../mail/messages.js';
import { authLogRepository, type AuthLogRepository } from '../repositories/auth-log.repository.js';
import {
  emailTokenRepository,
  type EmailTokenRepository,
} from '../repositories/email-token.repository.js';
import {
  passwordAccountRepository,
  type PasswordAccountRepository,
} from '../repositories/password-account.repository.js';
import { normalizeEmail } from './password-auth.service.js';
import type { RequestContext } from './session.service.js';

function databaseUnavailable(): AppError {
  return new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not available right now');
}

/** The one answer for a link that does not work: it never says whether it expired or was used. */
function invalidToken(): AppError {
  return new AppError(400, 'INVALID_TOKEN', 'The link is not valid or has expired');
}

function invalidPassword(problem: PasswordProblem): AppError {
  return new AppError(400, 'INVALID_PASSWORD', passwordProblemMessage(problem), { problem });
}

type TokenRepository = Pick<
  EmailTokenRepository,
  'issue' | 'findUsable' | 'accountState' | 'verifyEmail' | 'resetPassword'
>;

/**
 * The links that arrive by e-mail: verifying the email of an account, and choosing a new
 * password when the old one was forgotten.
 *
 * - A token is 32 random bytes; the e-mail carries it in the part of the link after "#" (which
 *   the browser never sends to a server, so it stays out of access logs and of Referer headers)
 *   and the database keeps only its hash. It works once and expires.
 * - A link that does not work always answers the same 400, whatever the reason.
 * - Asking for a recovery link answers the same whether or not the email has an account, and
 *   the message is sent after the answer, so neither the words nor the time tell. Choosing the
 *   new password closes every session of the person, and signs nobody in.
 * - Without the e-mail service configured the routes that send answer 503, and the rest of
 *   the API is not affected.
 * - The audit log never stops anything and keeps no token and no email.
 */
export class EmailLinkService {
  constructor(
    private readonly tokens: TokenRepository = emailTokenRepository,
    private readonly mail: MailSetup | null = createMailSetup(env),
    private readonly logs: Pick<AuthLogRepository, 'record'> = authLogRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly makeToken: () => string = generateEmailToken,
    private readonly passwords: Pick<
      PasswordAccountRepository,
      'findForLogin'
    > = passwordAccountRepository,
  ) {}

  /** Whether the e-mail service is set up (the server tells it when it starts). */
  get isConfigured(): boolean {
    return this.mail !== null;
  }

  /** Sends the person of a session the link that verifies their email. */
  async sendVerification(userId: string): Promise<void> {
    const mail = this.requireMail();
    let state;
    try {
      state = await this.tokens.accountState(userId);
    } catch (error) {
      console.error('Could not read an account:', error);
      throw databaseUnavailable();
    }
    if (!state || !state.isActive) {
      throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'The account does not exist');
    }
    if (state.emailVerified) {
      throw new AppError(409, 'ALREADY_VERIFIED', 'The email is already verified');
    }

    const link = await this.issueLink(mail, userId, 'verify_email', 'verificar');
    try {
      await mail.mailer.send(verificationMessage({ to: state.email, link }));
    } catch (error) {
      console.error('Could not send a verification e-mail:', (error as Error).message);
      throw new AppError(502, 'MAIL_FAILED', 'The e-mail could not be sent right now');
    }
  }

  /** Uses a verification link: the email of its account becomes verified. */
  async verifyEmail(token: string, request: RequestContext = {}): Promise<void> {
    const found = await this.findToken('verify_email', token);
    if (!found || !found.isActive) {
      await this.log('email_verified', false, null, request, 'invalid_token');
      throw invalidToken();
    }
    let used: boolean;
    try {
      used = await this.tokens.verifyEmail({
        tokenId: found.tokenId,
        userId: found.userId,
        now: this.now(),
      });
    } catch (error) {
      console.error('Could not verify an email:', error);
      throw databaseUnavailable();
    }
    if (!used) {
      await this.log('email_verified', false, found.userId, request, 'invalid_token');
      throw invalidToken();
    }
    await this.log('email_verified', true, found.userId, request);
  }

  /**
   * Sends the recovery link if the email belongs to an active account with a password. It says
   * nothing about it: the caller always answers the same. A Google-only account has no password
   * to recover, so it gets nothing.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const mail = this.requireMail();
    let record;
    try {
      record = await this.passwords.findForLogin(normalizeEmail(email));
    } catch (error) {
      console.error('Could not look up an account:', error);
      throw databaseUnavailable();
    }
    if (!record || !record.isActive) {
      return;
    }
    const link = await this.issueLink(mail, record.user.id, 'reset_password', 'restablecer');
    // Not awaited: waiting for Brevo would make an email with an account slower to answer.
    mail.mailer.send(resetMessage({ to: record.user.email, link })).catch((error: unknown) => {
      console.error('Could not send a recovery e-mail:', (error as Error).message);
    });
  }

  /**
   * Uses a recovery link: the password is replaced, every session of the person is closed and
   * the email counts as verified. It answers how many sessions it closed.
   */
  async resetPassword(
    token: string,
    newPassword: string,
    request: RequestContext = {},
  ): Promise<number> {
    const found = await this.findToken('reset_password', token);
    if (!found || !found.isActive || !found.hasPassword) {
      await this.log('password_reset', false, null, request, 'invalid_token');
      throw invalidToken();
    }
    const problem = passwordProblem(newPassword, found.email);
    if (problem) {
      // The link is not spent: the person can try again with another password.
      throw invalidPassword(problem);
    }

    const passwordHash = await hashPassword(newPassword);
    let closed: number | null;
    try {
      closed = await this.tokens.resetPassword({
        tokenId: found.tokenId,
        userId: found.userId,
        passwordHash,
        now: this.now(),
      });
    } catch (error) {
      console.error('Could not reset a password:', error);
      throw databaseUnavailable();
    }
    if (closed === null) {
      await this.log('password_reset', false, found.userId, request, 'invalid_token');
      throw invalidToken();
    }
    await this.log('password_reset', true, found.userId, request);
    return closed;
  }

  /** The token's account if the text is a token that can still be used, else null. */
  private async findToken(purpose: EmailTokenPurpose, token: string) {
    if (!isWellFormedEmailToken(token)) {
      return null;
    }
    try {
      return await this.tokens.findUsable(purpose, hashEmailToken(token), this.now());
    } catch (error) {
      console.error('Could not look up an e-mail link:', error);
      throw databaseUnavailable();
    }
  }

  /** Makes and stores a token and returns the link to put in the message. */
  private async issueLink(
    mail: MailSetup,
    userId: string,
    purpose: EmailTokenPurpose,
    page: string,
  ): Promise<string> {
    const token = this.makeToken();
    const now = this.now();
    try {
      await this.tokens.issue({
        userId,
        purpose,
        tokenHash: hashEmailToken(token),
        expiresAt: new Date(now.getTime() + EMAIL_TOKEN_TTL_MS[purpose]),
        now,
      });
    } catch (error) {
      console.error('Could not store an e-mail link:', error);
      throw databaseUnavailable();
    }
    return `${mail.appUrl}/${page}#token=${token}`;
  }

  private requireMail(): MailSetup {
    if (!this.mail) {
      throw new AppError(503, 'MAIL_NOT_CONFIGURED', 'E-mail is not available right now');
    }
    return this.mail;
  }

  private async log(
    eventType: 'email_verified' | 'password_reset',
    success: boolean,
    userId: string | null,
    request: RequestContext,
    reason?: string,
  ): Promise<void> {
    try {
      await this.logs.record({
        userId,
        eventType,
        success,
        userAgent: request.userAgent,
        ...(success ? {} : { ip: request.ip }),
        ...(reason ? { reason } : {}),
        now: this.now(),
      });
    } catch (error) {
      console.error('Could not write the auth log:', error);
    }
  }
}

export const emailLinkService = new EmailLinkService();

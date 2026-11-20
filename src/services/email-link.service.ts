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
import { verificationMessage } from '../mail/messages.js';
import { authLogRepository, type AuthLogRepository } from '../repositories/auth-log.repository.js';
import {
  emailTokenRepository,
  type EmailTokenRepository,
} from '../repositories/email-token.repository.js';
import type { RequestContext } from './session.service.js';

function databaseUnavailable(): AppError {
  return new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not available right now');
}

/** The one answer for a link that does not work: it never says whether it expired or was used. */
function invalidToken(): AppError {
  return new AppError(400, 'INVALID_TOKEN', 'The link is not valid or has expired');
}

type TokenRepository = Pick<
  EmailTokenRepository,
  'issue' | 'findUsable' | 'accountState' | 'verifyEmail'
>;

/**
 * The links that arrive by e-mail: verifying the email of an account.
 *
 * - A token is 32 random bytes; the e-mail carries it in the part of the link after "#" (which
 *   the browser never sends to a server, so it stays out of access logs and of Referer headers)
 *   and the database keeps only its hash. It works once and expires.
 * - A link that does not work always answers the same 400, whatever the reason.
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

import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { clientAddress } from '../middlewares/rate-limit.js';
import { getAuth, sendUnauthorized } from '../middlewares/require-session.js';
import { accountService, type AccountService } from '../services/account.service.js';
import { googleLoginService, type GoogleLoginService } from '../services/google-login.service.js';

/**
 * The body of POST /api/auth/google. An ID token is a JWT of about 1,000 to 1,500 characters;
 * 4,096 leaves room and still stops a body made only to be big. Other fields the Google
 * button hands the frontend (select_by, clientId...) are simply ignored.
 */
export const googleLoginSchema = z.object({
  credential: z
    .string({ error: 'credential must be the Google ID token' })
    .min(1, 'credential must not be empty')
    .max(4096, 'credential is too long'),
});

/**
 * The endpoints of the sign-in: POST /api/auth/google validates the body and answers the new
 * session and the person, and GET /api/auth/me tells who the current session belongs to.
 */
export class AuthController {
  constructor(
    private readonly service: Pick<GoogleLoginService, 'login'> = googleLoginService,
    private readonly accounts: Pick<AccountService, 'profile'> = accountService,
  ) {}

  loginWithGoogle = async (req: Request, res: Response) => {
    const parsed = googleLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        400,
        'INVALID_REQUEST',
        parsed.error.issues
          .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
          .join('; '),
      );
    }

    const result = await this.service.login(parsed.data.credential, {
      userAgent: req.get('user-agent'),
      ip: clientAddress(req),
    });

    // The session identifier is in this answer and never again: it must not be cached.
    res.set('Cache-Control', 'no-store').status(200).json({
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
      user: result.user,
    });
  };

  /**
   * GET /api/auth/me, behind requireSession: the person of the session, in the same shape as
   * the sign-in plus their permission codes. The roles are read from the tables every time,
   * so a promotion shows up at once. The frontend calls it when the app opens.
   */
  me = async (_req: Request, res: Response) => {
    const profile = await this.accounts.profile(getAuth(res).userId);
    if (!profile) {
      // The session was good a moment ago and the account is gone or deactivated since.
      sendUnauthorized(res);
      return;
    }
    res.set('Cache-Control', 'no-store').status(200).json({ user: profile });
  };
}

export const authController = new AuthController();

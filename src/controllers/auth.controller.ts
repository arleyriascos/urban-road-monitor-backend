import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { clientAddress } from '../middlewares/rate-limit.js';
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

/** POST /api/auth/google: validates the body and answers the new session and the person. */
export class AuthController {
  constructor(private readonly service: Pick<GoogleLoginService, 'login'> = googleLoginService) {}

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
}

export const authController = new AuthController();

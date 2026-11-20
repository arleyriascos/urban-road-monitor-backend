import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { clientAddress } from '../middlewares/rate-limit.js';
import { getAuth } from '../middlewares/require-session.js';
import { emailLinkService, type EmailLinkService } from '../services/email-link.service.js';

/** The token of a link is 43 characters; anything far bigger is stopped before it is looked at. */
const token = z
  .string({ error: 'token must be a text' })
  .min(1, 'token must not be empty')
  .max(200, 'token is too long');

export const verifyEmailSchema = z.object({ token });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(
      400,
      'INVALID_REQUEST',
      parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; '),
    );
  }
  return parsed.data;
}

/**
 * The endpoints of the links sent by e-mail: POST /api/auth/verify-email/send (behind a
 * session) and POST /api/auth/verify-email (the link; no session, because it may be opened on
 * another device).
 */
export class EmailLinkController {
  constructor(
    private readonly service: Pick<
      EmailLinkService,
      'sendVerification' | 'verifyEmail'
    > = emailLinkService,
  ) {}

  private context(req: Request) {
    return { userAgent: req.get('user-agent'), ip: clientAddress(req) };
  }

  sendVerification = async (req: Request, res: Response) => {
    await this.service.sendVerification(getAuth(res).userId);
    res.set('Cache-Control', 'no-store').status(200).json({ sent: true });
  };

  verifyEmail = async (req: Request, res: Response) => {
    const input = parse(verifyEmailSchema, req.body);
    await this.service.verifyEmail(input.token, this.context(req));
    res.set('Cache-Control', 'no-store').status(200).json({ verified: true });
  };
}

export const emailLinkController = new EmailLinkController();

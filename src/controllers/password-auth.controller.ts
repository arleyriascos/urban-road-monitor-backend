import type { Request, Response } from 'express';
import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from '../auth/password-rules.js';
import { FULL_NAME_MAX_LENGTH } from '../auth/profile-rules.js';
import { AppError } from '../errors/app-error.js';
import { clientAddress } from '../middlewares/rate-limit.js';
import { getAuth } from '../middlewares/require-session.js';
import {
  passwordAuthService,
  type PasswordAuthService,
  type PasswordLoginResult,
} from '../services/password-auth.service.js';

/**
 * The passwords are checked against the rules by the service, which answers which rule failed.
 * Here a text only has to be sane in size, so a body made only to be big is stopped before the
 * hashing: 1,024 characters is far more than the 128 the rules allow.
 */
const BODY_PASSWORD_MAX = PASSWORD_MAX_LENGTH * 8;

const password = (field: string) =>
  z
    .string({ error: `${field} must be a text` })
    .min(1, `${field} must not be empty`)
    .max(BODY_PASSWORD_MAX, `${field} is too long`);

export const registerSchema = z.object({
  name: z
    .string({ error: 'name must be a text' })
    .trim()
    .min(1, 'name must not be empty')
    .max(FULL_NAME_MAX_LENGTH, `name must have at most ${FULL_NAME_MAX_LENGTH} characters`),
  email: z
    .string({ error: 'email must be a text' })
    .trim()
    .max(255, 'email is too long')
    .pipe(z.email('email is not a valid address')),
  password: password('password'),
});

export const passwordLoginSchema = z.object({
  email: z
    .string({ error: 'email must be a text' })
    .trim()
    .min(1, 'email must not be empty')
    .max(255, 'email is too long'),
  password: password('password'),
});

export const changePasswordSchema = z.object({
  currentPassword: password('currentPassword'),
  newPassword: password('newPassword'),
});

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

function sessionAnswer(result: PasswordLoginResult) {
  return {
    token: result.token,
    expiresAt: result.expiresAt.toISOString(),
    user: result.user,
  };
}

/**
 * The endpoints of the accounts with a password: POST /api/auth/register, POST /api/auth/login
 * and POST /api/auth/password (behind a session). Every answer that carries a session
 * identifier is marked no-store: it is shown once.
 */
export class PasswordAuthController {
  constructor(
    private readonly service: Pick<
      PasswordAuthService,
      'register' | 'login' | 'changePassword'
    > = passwordAuthService,
  ) {}

  private context(req: Request) {
    return { userAgent: req.get('user-agent'), ip: clientAddress(req) };
  }

  register = async (req: Request, res: Response) => {
    const input = parse(registerSchema, req.body);
    const result = await this.service.register(input, this.context(req));
    res.set('Cache-Control', 'no-store').status(201).json(sessionAnswer(result));
  };

  login = async (req: Request, res: Response) => {
    const input = parse(passwordLoginSchema, req.body);
    const result = await this.service.login(input, this.context(req));
    res.set('Cache-Control', 'no-store').status(200).json(sessionAnswer(result));
  };

  /** Behind requireSession: changes the password and closes the person's other sessions. */
  changePassword = async (req: Request, res: Response) => {
    const input = parse(changePasswordSchema, req.body);
    const { userId, sessionId, email } = getAuth(res);
    const closed = await this.service.changePassword(
      { userId, sessionId, email },
      input,
      this.context(req),
    );
    res.set('Cache-Control', 'no-store').status(200).json({ otherSessionsClosed: closed });
  };
}

export const passwordAuthController = new PasswordAuthController();

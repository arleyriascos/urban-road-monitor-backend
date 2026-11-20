import { Router, type RequestHandler } from 'express';
import { authController, type AuthController } from '../controllers/auth.controller.js';
import {
  passwordAuthController,
  type PasswordAuthController,
} from '../controllers/password-auth.controller.js';
import {
  emailLinkController,
  type EmailLinkController,
} from '../controllers/email-link.controller.js';
import {
  loginRateLimit,
  passwordRecoveryEmailRateLimit,
  passwordRecoveryIpRateLimit,
  passwordResetRateLimit,
  passwordChangeRateLimit,
  passwordLoginEmailRateLimit,
  passwordLoginRateLimit,
  registerRateLimit,
  verificationRateLimit,
  verificationSendIpRateLimit,
  verificationSendUserRateLimit,
} from '../middlewares/rate-limit.js';
import { requireSession } from '../middlewares/require-session.js';

/** The limiters of the routes of the accounts with a password, each one counted apart. */
export interface PasswordRouteLimits {
  register: RequestHandler;
  login: RequestHandler;
  loginByEmail: RequestHandler;
  change: RequestHandler;
}

const passwordRouteLimits: PasswordRouteLimits = {
  register: registerRateLimit,
  login: passwordLoginRateLimit,
  loginByEmail: passwordLoginEmailRateLimit,
  change: passwordChangeRateLimit,
};

/** The limiters of the routes of the links sent by e-mail, each one counted apart. */
export interface EmailLinkRouteLimits {
  sendByIp: RequestHandler;
  /** Goes after the session check: it counts the person, not the address. */
  sendByUser: RequestHandler;
  verify: RequestHandler;
  forgotByIp: RequestHandler;
  forgotByEmail: RequestHandler;
  reset: RequestHandler;
}

const emailLinkRouteLimits: EmailLinkRouteLimits = {
  sendByIp: verificationSendIpRateLimit,
  sendByUser: verificationSendUserRateLimit,
  verify: verificationRateLimit,
  forgotByIp: passwordRecoveryIpRateLimit,
  forgotByEmail: passwordRecoveryEmailRateLimit,
  reset: passwordResetRateLimit,
};

/**
 * The routes of the sign-in, under /api. The controller, the limiter and the session check can
 * be given so the tests can use their own; the application uses the real ones.
 */
export function createAuthRouter(
  controller: Pick<AuthController, 'loginWithGoogle' | 'me' | 'logout'> = authController,
  rateLimit: RequestHandler = loginRateLimit,
  session: RequestHandler = requireSession(),
  password: Pick<
    PasswordAuthController,
    'register' | 'login' | 'changePassword'
  > = passwordAuthController,
  limits: PasswordRouteLimits = passwordRouteLimits,
  links: Pick<
    EmailLinkController,
    'sendVerification' | 'verifyEmail' | 'forgotPassword' | 'resetPassword'
  > = emailLinkController,
  linkLimits: EmailLinkRouteLimits = emailLinkRouteLimits,
): Router {
  const router = Router();
  // At most 10 attempts per minute and IP address, before the token is even looked at.
  router.post('/auth/google', rateLimit, controller.loginWithGoogle);
  // Accounts with an email and a password. Each route has its own limiter, counted apart.
  router.post('/auth/register', limits.register, password.register);
  router.post('/auth/login', limits.login, limits.loginByEmail, password.login);
  // Changes the password of the person of the session; the other sessions are closed.
  router.post('/auth/password', limits.change, session, password.changePassword);
  // Verifying the email: ask for the link (behind a session), and use it (no session: the link
  // may be opened on another device).
  router.post(
    '/auth/verify-email/send',
    linkLimits.sendByIp,
    session,
    linkLimits.sendByUser,
    links.sendVerification,
  );
  router.post('/auth/verify-email', linkLimits.verify, links.verifyEmail);
  // Recovering a forgotten password: ask for the link by email (always the same answer), and
  // choose the new password with it. Neither needs a session; the second closes all of them.
  router.post(
    '/auth/forgot-password',
    linkLimits.forgotByIp,
    linkLimits.forgotByEmail,
    links.forgotPassword,
  );
  router.post('/auth/reset-password', linkLimits.reset, links.resetPassword);
  // Who the current session belongs to. Only this route and the ones below need a session.
  router.get('/auth/me', session, controller.me);
  // Closes the session that makes the request, and only that one.
  router.post('/auth/logout', session, controller.logout);
  return router;
}

export const authRouter = createAuthRouter();

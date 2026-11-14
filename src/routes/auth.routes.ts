import { Router, type RequestHandler } from 'express';
import { authController, type AuthController } from '../controllers/auth.controller.js';
import { loginRateLimit } from '../middlewares/rate-limit.js';
import { requireSession } from '../middlewares/require-session.js';

/**
 * The routes of the sign-in, under /api. The controller, the limiter and the session check can
 * be given so the tests can use their own; the application uses the real ones.
 */
export function createAuthRouter(
  controller: Pick<AuthController, 'loginWithGoogle' | 'me' | 'logout'> = authController,
  rateLimit: RequestHandler = loginRateLimit,
  session: RequestHandler = requireSession(),
): Router {
  const router = Router();
  // At most 10 attempts per minute and IP address, before the token is even looked at.
  router.post('/auth/google', rateLimit, controller.loginWithGoogle);
  // Who the current session belongs to. Only this route and the ones below need a session.
  router.get('/auth/me', session, controller.me);
  // Closes the session that makes the request, and only that one.
  router.post('/auth/logout', session, controller.logout);
  return router;
}

export const authRouter = createAuthRouter();

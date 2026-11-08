import { Router, type RequestHandler } from 'express';
import { authController, type AuthController } from '../controllers/auth.controller.js';
import { loginRateLimit } from '../middlewares/rate-limit.js';

/**
 * The routes of the sign-in, under /api. The controller and the limiter can be given so the
 * tests can use their own; the application uses the real ones.
 */
export function createAuthRouter(
  controller: Pick<AuthController, 'loginWithGoogle'> = authController,
  rateLimit: RequestHandler = loginRateLimit,
): Router {
  const router = Router();
  // At most 10 attempts per minute and IP address, before the token is even looked at.
  router.post('/auth/google', rateLimit, controller.loginWithGoogle);
  return router;
}

export const authRouter = createAuthRouter();

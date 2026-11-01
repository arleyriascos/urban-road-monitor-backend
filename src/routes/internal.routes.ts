import { Router } from 'express';
import { env } from '../config/env.js';
import { internalController } from '../controllers/internal.controller.js';
import { requireInternalToken } from '../middlewares/internal-auth.js';

/**
 * Routes for the AI service, mounted at /internal (outside /api) in app.ts.
 * Every one of them needs the INTERNAL_TOKEN; without it configured they answer 404.
 */
export const internalRouter = Router();

internalRouter.use(requireInternalToken(env.INTERNAL_TOKEN));
internalRouter.get('/graph', internalController.getRoadGraph);

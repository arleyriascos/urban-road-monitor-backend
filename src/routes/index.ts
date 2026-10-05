import { Router } from 'express';
import { healthRouter } from './health.routes.js';

/** Groups every API route under the /api prefix (mounted in app.ts). */
export const apiRouter = Router();

apiRouter.use(healthRouter);

import { Router } from 'express';
import { docsRouter } from './docs.routes.js';
import { healthRouter } from './health.routes.js';

/** Groups every API route under the /api prefix (mounted in app.ts). */
export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use(docsRouter);

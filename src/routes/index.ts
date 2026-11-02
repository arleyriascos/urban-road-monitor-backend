import { Router } from 'express';
import { docsRouter } from './docs.routes.js';
import { healthRouter } from './health.routes.js';
import { mapRouter } from './map.routes.js';
import { routeRouter } from './route.routes.js';

/** Groups every API route under the /api prefix (mounted in app.ts). */
export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use(mapRouter);
apiRouter.use(routeRouter);
apiRouter.use(docsRouter);

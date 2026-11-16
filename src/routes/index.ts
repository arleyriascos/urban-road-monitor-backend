import { Router } from 'express';
import { authRouter } from './auth.routes.js';
import { clusteringRouter } from './clustering.routes.js';
import { docsRouter } from './docs.routes.js';
import { healthRouter } from './health.routes.js';
import { mapRouter } from './map.routes.js';
import { routeRouter } from './route.routes.js';
import { tripRouter } from './trip.routes.js';

/** Groups every API route under the /api prefix (mounted in app.ts). */
export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use(mapRouter);
apiRouter.use(routeRouter);
apiRouter.use(authRouter);
apiRouter.use(tripRouter);
apiRouter.use(clusteringRouter);
apiRouter.use(docsRouter);

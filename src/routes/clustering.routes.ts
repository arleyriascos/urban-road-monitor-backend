import { Router, type RequestHandler } from 'express';
import {
  clusteringController,
  type ClusteringController,
} from '../controllers/clustering.controller.js';
import { clusteringRateLimit } from '../middlewares/rate-limit.js';
import { requirePermission } from '../middlewares/require-permission.js';

/**
 * The routes of the consolidation, under /api. Both need the permission clustering.run, which
 * only the administrator has: the permission is what is asked, not the role.
 */
export function createClusteringRouter(
  controller: Pick<ClusteringController, 'start' | 'list'> = clusteringController,
  limit: RequestHandler = clusteringRateLimit,
  permission: RequestHandler = requirePermission('clustering.run'),
): Router {
  const router = Router();
  router.post('/clustering/runs', limit, permission, controller.start);
  router.get('/clustering/runs', limit, permission, controller.list);
  return router;
}

export const clusteringRouter = createClusteringRouter();

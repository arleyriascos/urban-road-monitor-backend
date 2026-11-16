import { Router, type RequestHandler } from 'express';
import {
  roadSearchController,
  type RoadSearchController,
} from '../controllers/road-search.controller.js';
import { searchRateLimit } from '../middlewares/rate-limit.js';

/** The street search, under /api. It is public, with a limit per IP address. */
export function createRoadSearchRouter(
  controller: Pick<RoadSearchController, 'search'> = roadSearchController,
  limit: RequestHandler = searchRateLimit,
): Router {
  const router = Router();
  router.get('/roads/search', limit, controller.search);
  return router;
}

export const roadSearchRouter = createRoadSearchRouter();

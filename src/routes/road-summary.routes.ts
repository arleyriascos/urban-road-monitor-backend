import { Router, type RequestHandler } from 'express';
import {
  roadSummaryController,
  type RoadSummaryController,
} from '../controllers/road-summary.controller.js';
import { summaryRateLimit } from '../middlewares/rate-limit.js';

/** The summaries of the streets, under /api. They are public, with a limit per IP address. */
export function createRoadSummaryRouter(
  controller: Pick<RoadSummaryController, 'segment' | 'road'> = roadSummaryController,
  limit: RequestHandler = summaryRateLimit,
): Router {
  const router = Router();
  router.get('/road-segments/:id/summary', limit, controller.segment);
  router.get('/roads/:id/summary', limit, controller.road);
  return router;
}

export const roadSummaryRouter = createRoadSummaryRouter();

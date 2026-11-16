import { Router, type RequestHandler } from 'express';
import { tripController, type TripController } from '../controllers/trip.controller.js';
import { detectionsRateLimit, tripsRateLimit } from '../middlewares/rate-limit.js';
import { requirePermission } from '../middlewares/require-permission.js';

/**
 * The routes of trips and detections, under /api. Recording needs the permission
 * detections.create, reading the own trips needs trips.view_own: the permission is what is
 * asked, not the role. The controller, the limiters and the permission checks can be given so
 * the tests can use their own.
 */
export function createTripRouter(
  controller: Pick<
    TripController,
    'start' | 'finish' | 'list' | 'get' | 'addDetections'
  > = tripController,
  limits: { trips: RequestHandler; detections: RequestHandler } = {
    trips: tripsRateLimit,
    detections: detectionsRateLimit,
  },
  permissions: { create: RequestHandler; viewOwn: RequestHandler } = {
    create: requirePermission('detections.create'),
    viewOwn: requirePermission('trips.view_own'),
  },
): Router {
  const router = Router();
  router.post('/trips', limits.trips, permissions.create, controller.start);
  router.patch('/trips/:id', limits.trips, permissions.create, controller.finish);
  router.get('/trips', limits.trips, permissions.viewOwn, controller.list);
  router.get('/trips/:id', limits.trips, permissions.viewOwn, controller.get);
  router.post(
    '/trips/:tripId/detections',
    limits.detections,
    permissions.create,
    controller.addDetections,
  );
  return router;
}

export const tripRouter = createTripRouter();

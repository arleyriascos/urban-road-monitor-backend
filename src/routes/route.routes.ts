import { Router } from 'express';
import { routeController } from '../controllers/route.controller.js';
import { routeRateLimit } from '../middlewares/rate-limit.js';

export const routeRouter = Router();

// At most 30 route requests per minute and IP address, cached or not.
routeRouter.post('/routes', routeRateLimit, routeController.findRoute);

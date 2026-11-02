import { Router } from 'express';
import { mapController } from '../controllers/map.controller.js';
import { aiWarmUp } from '../middlewares/ai-warm-up.js';

export const mapRouter = Router();

// Opening the map also starts waking the AI service up, without delaying the map.
mapRouter.get('/road-segments', aiWarmUp, mapController.getRoadSegments);
mapRouter.get('/potholes', mapController.getPotholes);
mapRouter.get('/road-network/stats', mapController.getNetworkStats);

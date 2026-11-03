import { Router } from 'express';
import { mapController } from '../controllers/map.controller.js';

export const mapRouter = Router();

mapRouter.get('/road-segments', mapController.getRoadSegments);
mapRouter.get('/potholes', mapController.getPotholes);
mapRouter.get('/road-network/stats', mapController.getNetworkStats);

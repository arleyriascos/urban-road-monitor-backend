import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { routeService } from '../services/route.service.js';

/**
 * Put before GET /api/road-segments: when someone opens the map, the AI service starts
 * waking up in the background, so it is usually awake when they ask for a route.
 * It never delays or changes the map's answer.
 */
export function createAiWarmUp(target: { wakeUp(): void }): RequestHandler {
  return (_req: Request, _res: Response, next: NextFunction) => {
    try {
      target.wakeUp();
    } catch (error) {
      console.error('Could not wake the AI service up:', error);
    }
    next();
  };
}

export const aiWarmUp = createAiWarmUp(routeService);

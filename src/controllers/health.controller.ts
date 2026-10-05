import type { Request, Response } from 'express';
import { healthService } from '../services/health.service.js';

/**
 * Controllers translate HTTP into service calls and back:
 * they pick the status code and send the JSON response.
 */
export const healthController = {
  async getHealth(_req: Request, res: Response) {
    const report = await healthService.getHealth();
    // 503 tells Render (and the frontend) that the API cannot reach the database.
    res.status(report.status === 'ok' ? 200 : 503).json(report);
  },

  async getHello(_req: Request, res: Response) {
    // Errors thrown here (e.g. database unavailable) reach the error-handling middleware.
    const hello = await healthService.getHello();
    res.status(200).json(hello);
  },
};

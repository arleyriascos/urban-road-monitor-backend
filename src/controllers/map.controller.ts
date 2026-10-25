import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { mapDataService, type MapDataService } from '../services/map-data.service.js';

const potholesQuerySchema = z.object({
  includeRepaired: z
    .enum(['true', 'false'], { error: 'includeRepaired debe ser true o false' })
    .default('false')
    .transform((value) => value === 'true'),
});

/**
 * Public endpoints that feed the map. Guests can use them too: they only read data.
 * "no-cache" makes browsers ask again each time; the ETag lets the server answer
 * 304 (nothing changed) without sending the whole body.
 */
export class MapController {
  constructor(private readonly service: MapDataService = mapDataService) {}

  getRoadSegments = async (_req: Request, res: Response) => {
    const segments = await this.service.getRoadSegments();
    res.set('Cache-Control', 'no-cache').status(200).json(segments);
  };

  getPotholes = async (req: Request, res: Response) => {
    const query = potholesQuerySchema.safeParse(req.query);
    if (!query.success) {
      throw new AppError(
        400,
        'INVALID_QUERY',
        query.error.issues.map((issue) => issue.message).join('; '),
      );
    }

    const potholes = await this.service.getPotholes(query.data);
    res.set('Cache-Control', 'no-cache').status(200).json(potholes);
  };

  getNetworkStats = async (_req: Request, res: Response) => {
    const stats = await this.service.getNetworkStats();
    res.set('Cache-Control', 'no-cache').status(200).json(stats);
  };
}

export const mapController = new MapController();

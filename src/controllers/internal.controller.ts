import type { Request, Response } from 'express';
import { roadGraphService, type RoadGraphService } from '../services/road-graph.service.js';

/**
 * Endpoints for the AI service only, protected by requireInternalToken.
 * "no-store": the graph is internal data, so no cache keeps a copy of it.
 */
export class InternalController {
  constructor(private readonly service: RoadGraphService = roadGraphService) {}

  getRoadGraph = async (_req: Request, res: Response) => {
    const graph = await this.service.getGraph();
    res.set('Cache-Control', 'no-store').status(200).json(graph);
  };
}

export const internalController = new InternalController();

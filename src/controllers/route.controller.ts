import type { Request, Response } from 'express';
import { AppError } from '../errors/app-error.js';
import { routeRequestSchema } from '../routing/route-request.js';
import type { RouteStreet } from '../roads/route-streets.js';
import { roadSummaryService, type RoadSummaryService } from '../services/road-summary.service.js';
import { routeService, type RouteAnswer, type RouteService } from '../services/route.service.js';

/**
 * POST /api/routes: validates the request and answers the route ready to draw, with the streets it
 * follows and the potholes along each part of them. The streets are a plus: if they cannot be
 * worked out, the route is answered without them instead of failing.
 */
export class RouteController {
  constructor(
    private readonly service: Pick<RouteService, 'findRoute'> = routeService,
    private readonly streets: Pick<RoadSummaryService, 'streetsOfRoute'> = roadSummaryService,
  ) {}

  findRoute = async (req: Request, res: Response) => {
    const parsed = routeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        400,
        'INVALID_REQUEST',
        parsed.error.issues
          .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
          .join('; '),
      );
    }

    const answer = await this.service.findRoute(parsed.data);
    const streets = await this.streetsOf(answer);
    res
      .set('Cache-Control', 'no-store')
      .status(200)
      .json(streets ? { ...answer, streets } : answer);
  };

  private async streetsOf(answer: RouteAnswer): Promise<RouteStreet[] | undefined> {
    try {
      return await this.streets.streetsOfRoute(
        answer.route.features.map((feature) => ({
          order: feature.properties.order,
          segmentId: feature.properties.segmentId,
        })),
      );
    } catch (error) {
      console.warn('The route is answered without its streets:', error);
      return undefined;
    }
  }
}

export const routeController = new RouteController();

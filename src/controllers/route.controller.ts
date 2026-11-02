import type { Request, Response } from 'express';
import { AppError } from '../errors/app-error.js';
import { routeRequestSchema } from '../routing/route-request.js';
import { routeService, type RouteService } from '../services/route.service.js';

/** POST /api/routes: validates the request and answers the route ready to draw. */
export class RouteController {
  constructor(private readonly service: Pick<RouteService, 'findRoute'> = routeService) {}

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
    res.set('Cache-Control', 'no-store').status(200).json(answer);
  };
}

export const routeController = new RouteController();

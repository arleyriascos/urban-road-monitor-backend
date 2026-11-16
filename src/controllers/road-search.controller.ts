import type { Request, Response } from 'express';
import { AppError } from '../errors/app-error.js';
import { roadSearchInputSchema } from '../roads/search-input.js';
import { roadSearchService, type RoadSearchService } from '../services/road-search.service.js';

/**
 * GET /api/roads/search?q=cal: the streets whose name starts with what was typed, so the page can
 * suggest them and center the map on the one that is picked. Public: it only reads. The names
 * change only when the road network is imported, so browsers may keep an answer for a minute.
 */
export class RoadSearchController {
  constructor(private readonly service: Pick<RoadSearchService, 'search'> = roadSearchService) {}

  search = async (req: Request, res: Response) => {
    const parsed = roadSearchInputSchema.safeParse({ query: req.query });
    if (!parsed.success) {
      throw new AppError(
        400,
        'INVALID_REQUEST',
        parsed.error.issues
          .map((issue) => `${issue.path.slice(1).join('.') || 'request'}: ${issue.message}`)
          .join('; '),
      );
    }
    const streets = await this.service.search(parsed.data.text, parsed.data.limit);
    res
      .set('Cache-Control', 'public, max-age=60')
      .status(200)
      .json({ query: parsed.data.text, streets });
  };
}

export const roadSearchController = new RoadSearchController();

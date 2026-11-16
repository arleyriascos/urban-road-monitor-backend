import type { Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../errors/app-error.js';
import { roadSummaryInputSchema, segmentSummaryInputSchema } from '../roads/summary-input.js';
import { roadSummaryService, type RoadSummaryService } from '../services/road-summary.service.js';

function parse<T>(schema: ZodType<T>, req: Request): T {
  const parsed = schema.safeParse({ params: req.params, query: req.query });
  if (!parsed.success) {
    throw new AppError(
      400,
      'INVALID_REQUEST',
      parsed.error.issues
        .map((issue) => `${issue.path.slice(1).join('.') || 'request'}: ${issue.message}`)
        .join('; '),
    );
  }
  return parsed.data;
}

/**
 * Public summaries of the potholes of a street, for the segment popup and for the streets of a
 * route. Guests can use them: they only read. They change at most every 10 seconds (the index is
 * checked that often), so browsers may keep an answer for that long.
 */
export class RoadSummaryController {
  constructor(
    private readonly service: Pick<
      RoadSummaryService,
      'segmentWindow' | 'road'
    > = roadSummaryService,
  ) {}

  /** GET /api/road-segments/:id/summary: the segment, the stretch around it and its street. */
  segment = async (req: Request, res: Response) => {
    const { segmentId, radius } = parse(segmentSummaryInputSchema, req);
    const answer = await this.service.segmentWindow(segmentId, radius);
    res.set('Cache-Control', 'public, max-age=10').status(200).json(answer);
  };

  /** GET /api/roads/:id/summary: a whole street, or the segments between two indexes. */
  road = async (req: Request, res: Response) => {
    const { roadId, range } = parse(roadSummaryInputSchema, req);
    const answer = await this.service.road(roadId, range);
    res.set('Cache-Control', 'public, max-age=10').status(200).json(answer);
  };
}

export const roadSummaryController = new RoadSummaryController();

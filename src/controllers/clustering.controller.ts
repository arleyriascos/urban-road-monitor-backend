import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { getAuth } from '../middlewares/require-session.js';
import {
  clusteringAdminService,
  type ClusteringAdminService,
} from '../services/clustering-admin.service.js';

export const DEFAULT_RUNS_PAGE = 10;
export const MAX_RUNS_PAGE = 50;

export const listRunsQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(MAX_RUNS_PAGE).default(DEFAULT_RUNS_PAGE) })
  .strict();

/** The consolidation of detections into potholes, for the administrator. */
export class ClusteringController {
  constructor(
    private readonly admin: Pick<
      ClusteringAdminService,
      'requestRun' | 'overview'
    > = clusteringAdminService,
  ) {}

  /** POST /api/clustering/runs: starts a run now. It answers 202 and the run goes on. */
  start = (_req: Request, res: Response) => {
    this.admin.requestRun(getAuth(res).userId);
    res.set('Cache-Control', 'no-store').status(202).json({
      status: 'started',
      message: 'The consolidation started; read GET /api/clustering/runs',
    });
  };

  /** GET /api/clustering/runs: the state of the consolidation and the latest runs. */
  list = async (req: Request, res: Response) => {
    const parsed = listRunsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(
        400,
        'INVALID_REQUEST',
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      );
    }
    res
      .set('Cache-Control', 'no-store')
      .status(200)
      .json(await this.admin.overview(parsed.data.limit));
  };
}

export const clusteringController = new ClusteringController();

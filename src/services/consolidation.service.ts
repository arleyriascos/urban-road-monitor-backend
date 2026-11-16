import { randomUUID } from 'node:crypto';
import { AiClusterClient, AiClusterError } from '../clustering/ai-cluster.client.js';
import {
  BrokenClusterAnswerError,
  MAX_DETECTIONS_PER_RUN,
  buildClusterRequest,
  readClusters,
  type AiClusterRequest,
  type AiClusterResponse,
} from '../clustering/ai-contract.js';
import { reconcile } from '../clustering/reconcile.js';
import { env } from '../config/env.js';
import {
  clusteringRunRepository,
  type ClusteringRunRepository,
  type RunStats,
  type RunTrigger,
} from '../repositories/clustering-run.repository.js';
import {
  consolidationRepository,
  type ConsolidationRepository,
} from '../repositories/consolidation.repository.js';
import {
  parameterRepository,
  type ParameterRepository,
} from '../repositories/parameter.repository.js';
import { NetworkVersionCache } from './network-version.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A run that says it is running for longer than this has been lost (the server stopped). */
export const STALE_RUN_MS = 10 * 60 * 1000;

export const DEFAULT_EPS_M = 5;
export const DEFAULT_MIN_POINTS = 2;
export const DEFAULT_WINDOW_DAYS = 90;

export type FailureCode =
  'AI_HIBERNATING' | 'AI_UNAVAILABLE' | 'AI_REJECTED' | 'AI_BROKEN_ANSWER' | 'DATABASE_ERROR';

/** How a run ended. A failure is recorded in clustering_runs; it is never thrown. */
export type RunOutcome =
  | { kind: 'finished'; runId: number; stats: RunStats; segmentsChanged: number }
  | { kind: 'busy' }
  | { kind: 'not_configured' }
  | { kind: 'failed'; runId: number | null; code: FailureCode; message: string };

export interface AiClusterPort {
  cluster(request: AiClusterRequest): Promise<AiClusterResponse>;
}

export interface ConsolidationDependencies {
  runs: Pick<ClusteringRunRepository, 'start' | 'finish' | 'fail' | 'abandonStale'>;
  store: Pick<ConsolidationRepository, 'loadDetections' | 'loadDerivedPotholes' | 'apply'>;
  parameters: Pick<ParameterRepository, 'getNumber'>;
  versions: Pick<NetworkVersionCache, 'current'>;
  /** Null when AI_SERVICE_URL or INTERNAL_TOKEN is missing. */
  ai: AiClusterPort | null;
  clock: () => Date;
  newId: () => string;
}

/**
 * One consolidation: it groups the detections of the last days into potholes.
 *
 * 1. Reads the detections of the window (90 days by default) and the potholes of earlier runs.
 * 2. Asks the AI service to group the detections (DBSCAN) and to put each group on its street.
 * 3. Decides which pothole each group becomes, so a pothole keeps its id from run to run.
 * 4. Writes potholes, links and the damage of the touched segments in one transaction.
 *
 * Everything is recorded in clustering_runs, and a run that fails changes nothing else. Only one
 * run can be running at a time (the table enforces it).
 */
export class ConsolidationService {
  private readonly deps: ConsolidationDependencies;

  constructor(deps?: Partial<ConsolidationDependencies>) {
    this.deps = {
      runs: clusteringRunRepository,
      store: consolidationRepository,
      parameters: parameterRepository,
      versions: new NetworkVersionCache(),
      ai:
        env.AI_SERVICE_URL && env.INTERNAL_TOKEN
          ? new AiClusterClient(env.AI_SERVICE_URL, env.INTERNAL_TOKEN)
          : null,
      clock: () => new Date(),
      newId: randomUUID,
      ...deps,
    };
  }

  get isConfigured(): boolean {
    return this.deps.ai !== null;
  }

  async run(trigger: RunTrigger, requestedBy: string | null = null): Promise<RunOutcome> {
    const { ai, runs, parameters } = this.deps;
    if (!ai) {
      return { kind: 'not_configured' };
    }

    const startedAt = this.deps.clock();
    let runId: number | null = null;
    try {
      await runs.abandonStale(new Date(startedAt.getTime() - STALE_RUN_MS), startedAt);
      const epsM = await parameters.getNumber('dbscan_eps_meters', DEFAULT_EPS_M);
      const minPoints = Math.round(
        await parameters.getNumber('dbscan_min_points', DEFAULT_MIN_POINTS),
      );
      const windowDays = Math.max(
        1,
        Math.round(await parameters.getNumber('clustering_window_days', DEFAULT_WINDOW_DAYS)),
      );

      runId = await runs.start({ trigger, requestedBy, epsM, minPoints, windowDays, startedAt });
      if (runId === null) {
        return { kind: 'busy' };
      }

      const result = await this.consolidate(ai, runId, { epsM, minPoints, windowDays, startedAt });
      await runs.finish(runId, result.stats, this.deps.clock());
      return { kind: 'finished', runId, ...result };
    } catch (error) {
      const failure = describeFailure(error);
      console.error(
        `Consolidation failed (${failure.code}): ${failure.message}`,
        failure.code === 'DATABASE_ERROR' ? error : '',
      );
      if (runId !== null) {
        try {
          await runs.fail(runId, failure.code, failure.message, this.deps.clock());
        } catch (writeError) {
          console.error('Could not record the failed run:', writeError);
        }
      }
      return { kind: 'failed', runId, ...failure };
    }
  }

  private async consolidate(
    ai: AiClusterPort,
    runId: number,
    run: { epsM: number; minPoints: number; windowDays: number; startedAt: Date },
  ): Promise<{ stats: RunStats; segmentsChanged: number }> {
    const { store } = this.deps;
    const since = new Date(run.startedAt.getTime() - run.windowDays * DAY_MS);
    const detections = await store.loadDetections(since, MAX_DETECTIONS_PER_RUN);
    if (detections.length === MAX_DETECTIONS_PER_RUN) {
      console.warn(
        `Consolidation read the ${MAX_DETECTIONS_PER_RUN} newest detections: older ones were left out`,
      );
    }

    // With nothing to group the AI service is not asked (it may be asleep): the answer is known.
    const clusters =
      detections.length === 0
        ? []
        : readClusters(
            await ai.cluster(
              buildClusterRequest(detections, {
                epsM: run.epsM,
                minPoints: run.minPoints,
                asOf: run.startedAt,
                graphVersion: await this.deps.versions.current(),
              }),
            ),
            detections,
          );

    const plan = reconcile({
      clusters,
      existing: await store.loadDerivedPotholes(),
      previousPothole: new Map(detections.map((detection) => [detection.id, detection.potholeId])),
      maxMatchDistanceM: run.epsM,
      newId: this.deps.newId,
    });
    const applied = await store.apply(plan, runId);

    return {
      stats: {
        detectionsProcessed: detections.length,
        clustersFound: clusters.length,
        potholesCreated: applied.created,
        potholesUpdated: applied.updated,
        potholesRemoved: applied.removed,
      },
      segmentsChanged: applied.segmentsChanged,
    };
  }
}

function describeFailure(error: unknown): { code: FailureCode; message: string } {
  if (error instanceof AiClusterError) {
    const failure = error.failure;
    if (failure.kind === 'hibernating') {
      return {
        code: 'AI_HIBERNATING',
        message: 'The AI service is asleep and Render will not wake it for the backend',
      };
    }
    if (failure.kind === 'rejected') {
      return {
        code: 'AI_REJECTED',
        message: `The AI service rejected the request: ${failure.code}`,
      };
    }
    return { code: 'AI_UNAVAILABLE', message: failure.reason };
  }
  if (error instanceof BrokenClusterAnswerError) {
    return { code: 'AI_BROKEN_ANSWER', message: error.message };
  }
  return { code: 'DATABASE_ERROR', message: 'The database failed while consolidating' };
}

export const consolidationService = new ConsolidationService();

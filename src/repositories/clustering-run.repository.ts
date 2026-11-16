import { prisma } from '../config/database.js';
import type { PrismaClient } from '../generated/prisma/client.js';

export type RunTrigger = 'automatic' | 'manual';
export type RunStatus = 'running' | 'finished' | 'failed';

/** One run of the consolidation, as clustering_runs records it. */
export interface RunRow {
  id: number;
  status: RunStatus;
  trigger: RunTrigger;
  requestedBy: string | null;
  epsM: number;
  minPoints: number;
  windowDays: number | null;
  detectionsProcessed: number;
  clustersFound: number;
  potholesCreated: number;
  potholesUpdated: number;
  potholesRemoved: number;
  startedAt: Date;
  finishedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface NewRun {
  trigger: RunTrigger;
  requestedBy: string | null;
  epsM: number;
  minPoints: number;
  windowDays: number;
  startedAt: Date;
}

export interface RunStats {
  detectionsProcessed: number;
  clustersFound: number;
  potholesCreated: number;
  potholesUpdated: number;
  potholesRemoved: number;
}

interface RawRun {
  id: number;
  status: RunStatus;
  trigger_kind: RunTrigger;
  requested_by: string | null;
  eps_meters: number;
  min_points: number;
  window_days: number | null;
  detections_processed: number;
  clusters_found: number;
  potholes_created: number;
  potholes_updated: number;
  potholes_removed: number;
  started_at: Date;
  finished_at: Date | null;
  error_code: string | null;
  error_message: string | null;
}

const COLUMNS = `id, status, trigger_kind, requested_by::text AS requested_by,
  eps_meters::float8 AS eps_meters, min_points, window_days, detections_processed,
  clusters_found, potholes_created, potholes_updated, potholes_removed,
  started_at, finished_at, error_code, error_message`;

function toRun(row: RawRun): RunRow {
  return {
    id: row.id,
    status: row.status,
    trigger: row.trigger_kind,
    requestedBy: row.requested_by,
    epsM: row.eps_meters,
    minPoints: row.min_points,
    windowDays: row.window_days,
    detectionsProcessed: row.detections_processed,
    clustersFound: row.clusters_found,
    potholesCreated: row.potholes_created,
    potholesUpdated: row.potholes_updated,
    potholesRemoved: row.potholes_removed,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
}

/** Reads and writes clustering_runs. Every time comes from the caller, never from NOW(). */
export class ClusteringRunRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Starts a run. The database lets only one run be "running" at a time, whatever number of
   * servers there are: if another one is running, nothing is written and the answer is null.
   */
  async start(run: NewRun): Promise<number | null> {
    const rows = await this.db.$queryRaw<{ id: number }[]>`
      INSERT INTO clustering_runs
        (status, trigger_kind, requested_by, eps_meters, min_points, window_days, started_at)
      VALUES ('running', ${run.trigger}, ${run.requestedBy}::uuid, ${run.epsM}, ${run.minPoints},
              ${run.windowDays}, ${run.startedAt})
      ON CONFLICT DO NOTHING
      RETURNING id`;
    return rows[0]?.id ?? null;
  }

  async finish(id: number, stats: RunStats, finishedAt: Date): Promise<void> {
    await this.db.$executeRaw`
      UPDATE clustering_runs
      SET status = 'finished', finished_at = ${finishedAt},
          detections_processed = ${stats.detectionsProcessed},
          clusters_found = ${stats.clustersFound},
          potholes_created = ${stats.potholesCreated},
          potholes_updated = ${stats.potholesUpdated},
          potholes_removed = ${stats.potholesRemoved}
      WHERE id = ${id} AND status = 'running'`;
  }

  async fail(id: number, code: string, message: string, finishedAt: Date): Promise<void> {
    await this.db.$executeRaw`
      UPDATE clustering_runs
      SET status = 'failed', finished_at = ${finishedAt},
          error_code = ${code.slice(0, 40)}, error_message = ${message.slice(0, 300)}
      WHERE id = ${id} AND status = 'running'`;
  }

  /**
   * Marks as failed a run that has been "running" since before `before`: the server stopped
   * (a deploy, a crash) and nobody will finish it, and it would block every later run.
   */
  async abandonStale(before: Date, now: Date): Promise<number> {
    return this.db.$executeRaw`
      UPDATE clustering_runs
      SET status = 'failed', finished_at = GREATEST(${now}, started_at),
          error_code = 'ABANDONED', error_message = 'The server stopped before the run ended'
      WHERE status = 'running' AND started_at < ${before}`;
  }

  async findLatest(): Promise<RunRow | null> {
    const rows = await this.db.$queryRawUnsafe<RawRun[]>(
      `SELECT ${COLUMNS} FROM clustering_runs ORDER BY started_at DESC, id DESC LIMIT 1`,
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async list(limit: number): Promise<RunRow[]> {
    const rows = await this.db.$queryRawUnsafe<RawRun[]>(
      `SELECT ${COLUMNS} FROM clustering_runs ORDER BY started_at DESC, id DESC LIMIT $1`,
      limit,
    );
    return rows.map(toRun);
  }

  /** When the last run that ended well started: what it read is what it knew. */
  async findLastFinishedStart(): Promise<Date | null> {
    const [row] = await this.db.$queryRaw<{ started_at: Date | null }[]>`
      SELECT MAX(started_at) AS started_at FROM clustering_runs WHERE status = 'finished'`;
    return row?.started_at ?? null;
  }

  /** How many detections arrived after `since` (all of them if it is null). */
  async countDetectionsReceivedAfter(since: Date | null): Promise<number> {
    const [row] = await this.db.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM detections
      WHERE ${since}::timestamptz IS NULL OR received_at > ${since}::timestamptz`;
    return row?.total ?? 0;
  }
}

export const clusteringRunRepository = new ClusteringRunRepository();

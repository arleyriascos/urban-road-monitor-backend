import { prisma } from '../config/database.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { SEVERITY_NAMES, type ClusterInput, type SeverityName } from '../clustering/ai-contract.js';
import type { ReconcilePlan } from '../clustering/reconcile.js';
import type { ExistingPothole } from '../clustering/status.js';
import { roundTo } from '../osm/geo.js';
import { SegmentDamageRepository } from './segment-damage.repository.js';

/** A detection read for a run, with the pothole it belonged to before the run. */
export interface WindowDetection extends ClusterInput {
  potholeId: string | null;
}

export interface ApplyResult {
  created: number;
  updated: number;
  removed: number;
  segmentsChanged: number;
}

interface RawDetection {
  id: string;
  latitude: number;
  longitude: number;
  severity: string;
  confidence: number;
  detected_at: Date;
  pothole_id: string | null;
}

interface RawPothole {
  id: string;
  latitude: number;
  longitude: number;
  status: string;
  segment_id: bigint | null;
  repaired_at: Date | null;
}

const CHUNK_SIZE = 2_000;
const APPLY_TIMEOUT_MS = 2 * 60 * 1000;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function isSeverityName(value: string): value is SeverityName {
  return (SEVERITY_NAMES as readonly string[]).includes(value);
}

/** Reads what a run groups and writes what the run decided, all in one transaction. */
export class ConsolidationRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * The newest detections seen since `since`, at most `limit` of them, in a fixed order (the
   * AI service names each one by its position in this list).
   */
  async loadDetections(since: Date, limit: number): Promise<WindowDetection[]> {
    const rows = await this.db.$queryRaw<RawDetection[]>`
      SELECT d.id::text AS id,
             d.latitude::float8 AS latitude,
             d.longitude::float8 AS longitude,
             sl.name AS severity,
             d.model_confidence::float8 AS confidence,
             d.detected_at,
             d.pothole_id::text AS pothole_id
      FROM detections d
      JOIN severity_levels sl ON sl.id = d.severity_level_id
      WHERE d.detected_at >= ${since}
      ORDER BY d.detected_at DESC, d.id
      LIMIT ${limit}`;

    return rows.flatMap((row) =>
      isSeverityName(row.severity)
        ? [
            {
              id: row.id,
              latitude: row.latitude,
              longitude: row.longitude,
              severity: row.severity,
              confidence: row.confidence,
              detectedAt: row.detected_at,
              potholeId: row.pothole_id,
            },
          ]
        : [],
    );
  }

  /**
   * The potholes that earlier runs made. A pothole of the seed (invented, for trying the map)
   * has no run and no detection, so it is not here and no run ever changes or removes it.
   */
  async loadDerivedPotholes(): Promise<ExistingPothole[]> {
    const rows = await this.db.$queryRaw<RawPothole[]>`
      SELECT p.id::text AS id,
             p.latitude::float8 AS latitude,
             p.longitude::float8 AS longitude,
             ps.name AS status,
             p.road_segment_id AS segment_id,
             (SELECT MAX(h.changed_at)
              FROM pothole_status_history h
              JOIN pothole_statuses hs ON hs.id = h.status_id AND hs.name = 'reparado'
              WHERE h.pothole_id = p.id) AS repaired_at
      FROM potholes p
      JOIN pothole_statuses ps ON ps.id = p.status_id
      WHERE p.last_clustering_run_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM detections d WHERE d.pothole_id = p.id)
      ORDER BY p.id`;

    return rows.map((row) => ({
      id: row.id,
      latitude: row.latitude,
      longitude: row.longitude,
      statusName: row.status,
      repairedAt: row.repaired_at,
      segmentId: row.segment_id === null ? null : Number(row.segment_id),
    }));
  }

  /** Writes the plan of a run: potholes, links with detections and damage, or nothing at all. */
  async apply(plan: ReconcilePlan, runId: number): Promise<ApplyResult> {
    return this.db.$transaction(
      async (tx) => {
        const severities = new Map(
          (
            await tx.$queryRaw<{ id: number; name: string }[]>`SELECT id, name FROM severity_levels`
          ).map((row) => [row.name, row.id]),
        );
        const statuses = new Map(
          (
            await tx.$queryRaw<
              { id: number; name: string }[]
            >`SELECT id, name FROM pothole_statuses`
          ).map((row) => [row.name, row.id]),
        );

        // The segments whose damage must be worked out again, found before anything changes.
        const touched = new Set<number>();
        if (plan.removedIds.length > 0) {
          const rows = await tx.$queryRaw<{ segment_id: bigint }[]>`
            SELECT DISTINCT road_segment_id AS segment_id FROM potholes
            WHERE id = ANY(${plan.removedIds}::uuid[]) AND road_segment_id IS NOT NULL`;
          for (const row of rows) touched.add(Number(row.segment_id));
          await tx.$executeRaw`DELETE FROM potholes WHERE id = ANY(${plan.removedIds}::uuid[])`;
        }

        for (const part of chunk(plan.potholes, CHUNK_SIZE)) {
          const rows = part.map((pothole) => {
            const severityId = severities.get(pothole.cluster.severity);
            const statusId = statuses.get(pothole.status);
            if (severityId === undefined || statusId === undefined) {
              throw new Error(
                `Unknown severity or status: ${pothole.cluster.severity}, ${pothole.status}`,
              );
            }
            if (pothole.previousSegmentId !== null) touched.add(pothole.previousSegmentId);
            if (pothole.cluster.segmentId !== null) touched.add(pothole.cluster.segmentId);
            return {
              id: pothole.id,
              road_segment_id: pothole.cluster.segmentId,
              severity_level_id: severityId,
              status_id: statusId,
              latitude: roundTo(pothole.cluster.latitude, 6),
              longitude: roundTo(pothole.cluster.longitude, 6),
              confidence: roundTo(pothole.cluster.confidence, 4),
              detection_count: pothole.cluster.count,
              first_detected_at: pothole.cluster.firstDetectedAt.toISOString(),
              last_detected_at: pothole.cluster.lastDetectedAt.toISOString(),
            };
          });
          await tx.$executeRaw`
            INSERT INTO potholes
              (id, road_segment_id, severity_level_id, status_id, last_clustering_run_id,
               latitude, longitude, confidence, detection_count, first_detected_at,
               last_detected_at)
            SELECT r.id,
                   (SELECT s.id FROM road_segments s WHERE s.id = r.road_segment_id),
                   r.severity_level_id, r.status_id, ${runId},
                   r.latitude, r.longitude, r.confidence, r.detection_count,
                   r.first_detected_at, r.last_detected_at
            FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
              AS r(id uuid, road_segment_id bigint, severity_level_id int, status_id int,
                   latitude numeric, longitude numeric, confidence numeric,
                   detection_count int, first_detected_at timestamptz,
                   last_detected_at timestamptz)
            ON CONFLICT (id) DO UPDATE SET
              road_segment_id = EXCLUDED.road_segment_id,
              severity_level_id = EXCLUDED.severity_level_id,
              status_id = EXCLUDED.status_id,
              last_clustering_run_id = EXCLUDED.last_clustering_run_id,
              latitude = EXCLUDED.latitude,
              longitude = EXCLUDED.longitude,
              confidence = EXCLUDED.confidence,
              detection_count = EXCLUDED.detection_count,
              first_detected_at = EXCLUDED.first_detected_at,
              last_detected_at = EXCLUDED.last_detected_at`;
        }

        for (const part of chunk(plan.unlinkedDetectionIds, CHUNK_SIZE)) {
          await tx.$executeRaw`
            UPDATE detections SET pothole_id = NULL
            WHERE id = ANY(${part}::uuid[]) AND pothole_id IS NOT NULL`;
        }
        const links = plan.potholes.flatMap((pothole) =>
          pothole.cluster.detectionIds.map((detectionId) => ({
            detection_id: detectionId,
            pothole_id: pothole.id,
          })),
        );
        for (const part of chunk(links, CHUNK_SIZE)) {
          await tx.$executeRaw`
            UPDATE detections d SET pothole_id = u.pothole_id
            FROM jsonb_to_recordset(${JSON.stringify(part)}::jsonb)
              AS u(detection_id uuid, pothole_id uuid)
            WHERE d.id = u.detection_id AND d.pothole_id IS DISTINCT FROM u.pothole_id`;
        }

        const segmentsChanged = await new SegmentDamageRepository(tx).recompute([...touched]);
        const created = plan.potholes.filter((pothole) => pothole.isNew).length;
        return {
          created,
          updated: plan.potholes.length - created,
          removed: plan.removedIds.length,
          segmentsChanged,
        };
      },
      { timeout: APPLY_TIMEOUT_MS, maxWait: 30_000 },
    );
  }
}

export const consolidationRepository = new ConsolidationRepository();

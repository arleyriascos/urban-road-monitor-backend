import { prisma } from '../config/database.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { computeSegmentDamage } from '../services/segment-damage.js';

/** What the repository needs of the database: the client itself, or a transaction of it. */
export type RawDatabase = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

interface PotholeOfSegment {
  segment_id: bigint;
  severity_level_id: number;
  weight: number;
  confidence: number;
  status: string;
}

/**
 * Works out again the damage of some segments from the potholes that are on them, and writes
 * it to road_segments (damage_score and max_severity_level_id). The rule is computeSegmentDamage:
 * only confirmed potholes count. A segment that no longer has any is set back to no damage.
 *
 * Only rows whose damage changes are written, so updated_at does not move for nothing.
 */
export class SegmentDamageRepository {
  constructor(private readonly db: RawDatabase = prisma) {}

  /** Returns how many segments changed. */
  async recompute(segmentIds: readonly number[]): Promise<number> {
    const ids = [...new Set(segmentIds)];
    if (ids.length === 0) {
      return 0;
    }
    const rows = await this.db.$queryRaw<PotholeOfSegment[]>`
      SELECT p.road_segment_id AS segment_id,
             p.severity_level_id,
             sl.cost_weight::float8 AS weight,
             p.confidence::float8 AS confidence,
             ps.name AS status
      FROM potholes p
      JOIN severity_levels sl ON sl.id = p.severity_level_id
      JOIN pothole_statuses ps ON ps.id = p.status_id
      WHERE p.road_segment_id = ANY(${ids}::bigint[])`;

    const bySegment = new Map<number, PotholeOfSegment[]>(ids.map((id) => [id, []]));
    for (const row of rows) {
      bySegment.get(Number(row.segment_id))?.push(row);
    }

    const updates = [...bySegment].map(([id, potholes]) => {
      const damage = computeSegmentDamage(
        potholes.map((pothole) => ({
          severityId: pothole.severity_level_id,
          severityWeight: pothole.weight,
          confidence: pothole.confidence,
          affectsRoutes: pothole.status === 'confirmado',
        })),
      );
      return {
        id,
        damage_score: damage.damageScore,
        max_severity_level_id: damage.maxSeverityLevelId,
      };
    });

    return this.db.$executeRaw`
      UPDATE road_segments rs
      SET damage_score = u.damage_score, max_severity_level_id = u.max_severity_level_id
      FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
        AS u(id bigint, damage_score numeric, max_severity_level_id int)
      WHERE rs.id = u.id
        AND (rs.damage_score IS DISTINCT FROM u.damage_score
             OR rs.max_severity_level_id IS DISTINCT FROM u.max_severity_level_id)`;
  }
}

export const segmentDamageRepository = new SegmentDamageRepository();

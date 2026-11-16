import { prisma } from '../config/database.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { SegmentFacts } from '../roads/stretch-summary.js';

interface RawFacts {
  segment_id: bigint;
  road_id: bigint;
  road_name: string | null;
  segment_index: number;
  length_m: number;
  visible: number;
  confirmed: number;
  damage_score: number;
  worst_name: string | null;
  worst_weight: number | null;
}

/** Reads what the street summaries are made from: every segment with its potholes and damage. */
export class RoadFactsRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  /** Every segment of every street, with the potholes on it counted. */
  async findAll(): Promise<SegmentFacts[]> {
    const rows = await this.db.$queryRaw<RawFacts[]>`
      SELECT rs.id AS segment_id,
             rs.road_id,
             r.name AS road_name,
             rs.segment_index,
             rs.length_m::float8 AS length_m,
             COUNT(p.id) FILTER (WHERE ps.name <> 'reparado')::int AS visible,
             COUNT(p.id) FILTER (WHERE ps.name = 'confirmado')::int AS confirmed,
             rs.damage_score::float8 AS damage_score,
             sl.name AS worst_name,
             sl.cost_weight::float8 AS worst_weight
      FROM road_segments rs
      JOIN roads r ON r.id = rs.road_id
      LEFT JOIN severity_levels sl ON sl.id = rs.max_severity_level_id
      LEFT JOIN potholes p ON p.road_segment_id = rs.id
      LEFT JOIN pothole_statuses ps ON ps.id = p.status_id
      GROUP BY rs.id, r.name, sl.name, sl.cost_weight
      ORDER BY rs.road_id, rs.segment_index`;

    return rows.map((row) => ({
      segmentId: Number(row.segment_id),
      roadId: Number(row.road_id),
      roadName: row.road_name,
      segmentIndex: row.segment_index,
      lengthM: row.length_m,
      visiblePotholes: row.visible,
      confirmedPotholes: row.confirmed,
      damageScore: row.damage_score,
      worstSeverity:
        row.worst_name === null || row.worst_weight === null
          ? null
          : { name: row.worst_name, weight: row.worst_weight },
    }));
  }

  /**
   * A short text that changes whenever the segments or the potholes change: how many there are
   * and when each table was last touched. It is cheap, so it can be asked often, and the whole
   * list is read only when it changes.
   */
  async findStamp(): Promise<string> {
    const [row] = await this.db.$queryRaw<{ stamp: string }[]>`
      SELECT concat_ws(
        '|',
        (SELECT COUNT(*) FROM road_segments),
        (SELECT COALESCE(MAX(updated_at)::text, '') FROM road_segments),
        (SELECT COUNT(*) FROM potholes),
        (SELECT COALESCE(MAX(updated_at)::text, '') FROM potholes)
      ) AS stamp`;
    return row?.stamp ?? '';
  }
}

export const roadFactsRepository = new RoadFactsRepository();

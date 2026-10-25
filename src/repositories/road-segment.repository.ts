import { prisma } from '../config/database.js';
import type { LatLon } from '../osm/types.js';

/** One road segment as shown on the map (read from the v_segment_status view). */
export interface SegmentStatusRow {
  id: number;
  roadId: number;
  roadName: string | null;
  roadType: string;
  lengthM: number;
  isOneway: boolean;
  damageScore: number;
  /** "sin baches", "leve", "moderado" or "grave". */
  severity: string;
  color: string;
  activePotholes: number;
  /** Points of the segment as [latitude, longitude]. */
  geometry: LatLon[];
}

export interface NetworkTotalsRow {
  roads: number;
  segments: number;
  totalLengthM: number;
}

export interface SeverityLevelRow {
  name: string;
  color: string;
  costWeight: number;
}

export interface SeverityCountRow {
  severity: string;
  count: number;
}

interface RawSegmentRow {
  segment_id: bigint;
  road_id: bigint;
  road_name: string | null;
  road_type: string;
  length_m: number;
  is_oneway: boolean;
  damage_score: number;
  max_severity: string;
  color_hex: string;
  active_potholes: number;
  geometry: LatLon[];
}

/** Reads road segments and network totals. The v_segment_status view does the joins. */
export class RoadSegmentRepository {
  async findAllStatuses(): Promise<SegmentStatusRow[]> {
    // numeric and bigint columns are cast so they arrive as plain JavaScript numbers.
    const rows = await prisma.$queryRaw<RawSegmentRow[]>`
      SELECT segment_id, road_id, road_name, road_type,
             length_m::float8 AS length_m, is_oneway,
             damage_score::float8 AS damage_score,
             max_severity, color_hex,
             active_potholes::int AS active_potholes,
             geometry
      FROM v_segment_status
      ORDER BY segment_id`;

    return rows.map((row) => ({
      id: Number(row.segment_id),
      roadId: Number(row.road_id),
      roadName: row.road_name,
      roadType: row.road_type,
      lengthM: row.length_m,
      isOneway: row.is_oneway,
      damageScore: row.damage_score,
      severity: row.max_severity,
      color: row.color_hex,
      activePotholes: row.active_potholes,
      geometry: row.geometry,
    }));
  }

  async getTotals(): Promise<NetworkTotalsRow> {
    const [row] = await prisma.$queryRaw<
      { roads: number; segments: number; total_length_m: number }[]
    >`
      SELECT (SELECT COUNT(*) FROM roads)::int AS roads,
             (SELECT COUNT(*) FROM road_segments)::int AS segments,
             (SELECT COALESCE(SUM(length_m), 0) FROM road_segments)::float8 AS total_length_m`;

    return { roads: row.roads, segments: row.segments, totalLengthM: row.total_length_m };
  }

  /** Segments grouped by their worst pothole severity ("sin baches" when there is none). */
  async countBySeverity(): Promise<SeverityCountRow[]> {
    return prisma.$queryRaw<SeverityCountRow[]>`
      SELECT COALESCE(sl.name, 'sin baches') AS severity, COUNT(*)::int AS count
      FROM road_segments rs
      LEFT JOIN severity_levels sl ON sl.id = rs.max_severity_level_id
      GROUP BY COALESCE(sl.name, 'sin baches')`;
  }

  async findSeverityLevels(): Promise<SeverityLevelRow[]> {
    const rows = await prisma.$queryRaw<{ name: string; color_hex: string; cost_weight: number }[]>`
      SELECT name, color_hex, cost_weight::float8 AS cost_weight
      FROM severity_levels
      ORDER BY cost_weight`;

    return rows.map((row) => ({
      name: row.name,
      color: row.color_hex,
      costWeight: row.cost_weight,
    }));
  }
}

export const roadSegmentRepository = new RoadSegmentRepository();

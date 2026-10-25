import { prisma } from '../config/database.js';

/** One consolidated pothole, ready to be drawn as a marker. */
export interface PotholeRow {
  id: string;
  latitude: number;
  longitude: number;
  severity: string;
  color: string;
  status: string;
  confidence: number;
  detectionCount: number;
  segmentId: number | null;
  roadName: string | null;
  firstDetectedAt: Date;
  lastDetectedAt: Date;
}

export interface StatusCountRow {
  status: string;
  count: number;
}

interface RawPotholeRow {
  id: string;
  latitude: number;
  longitude: number;
  severity: string;
  color: string;
  status: string;
  confidence: number;
  detection_count: number;
  road_segment_id: bigint | null;
  road_name: string | null;
  first_detected_at: Date;
  last_detected_at: Date;
}

export class PotholeRepository {
  /** Repaired potholes are left out unless includeRepaired is true. */
  async findAll(includeRepaired: boolean): Promise<PotholeRow[]> {
    const rows = await prisma.$queryRaw<RawPotholeRow[]>`
      SELECT p.id::text AS id,
             p.latitude::float8 AS latitude,
             p.longitude::float8 AS longitude,
             sl.name AS severity,
             sl.color_hex AS color,
             ps.name AS status,
             p.confidence::float8 AS confidence,
             p.detection_count::int AS detection_count,
             p.road_segment_id,
             r.name AS road_name,
             p.first_detected_at,
             p.last_detected_at
      FROM potholes p
      JOIN severity_levels sl ON sl.id = p.severity_level_id
      JOIN pothole_statuses ps ON ps.id = p.status_id
      LEFT JOIN road_segments rs ON rs.id = p.road_segment_id
      LEFT JOIN roads r ON r.id = rs.road_id
      WHERE ${includeRepaired}::boolean OR ps.name <> 'reparado'
      ORDER BY p.last_detected_at DESC, p.id`;

    return rows.map((row) => ({
      id: row.id,
      latitude: row.latitude,
      longitude: row.longitude,
      severity: row.severity,
      color: row.color,
      status: row.status,
      confidence: row.confidence,
      detectionCount: row.detection_count,
      segmentId: row.road_segment_id === null ? null : Number(row.road_segment_id),
      roadName: row.road_name,
      firstDetectedAt: row.first_detected_at,
      lastDetectedAt: row.last_detected_at,
    }));
  }

  async countByStatus(): Promise<StatusCountRow[]> {
    return prisma.$queryRaw<StatusCountRow[]>`
      SELECT ps.name AS status, COUNT(*)::int AS count
      FROM potholes p
      JOIN pothole_statuses ps ON ps.id = p.status_id
      GROUP BY ps.name`;
  }

  async findLastDetectionAt(): Promise<Date | null> {
    const [row] = await prisma.$queryRaw<{ last_detection: Date | null }[]>`
      SELECT MAX(last_detected_at) AS last_detection FROM potholes`;
    return row.last_detection;
  }
}

export const potholeRepository = new PotholeRepository();

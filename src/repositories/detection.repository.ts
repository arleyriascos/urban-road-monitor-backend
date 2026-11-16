import { prisma } from '../config/database.js';
import type { PrismaClient } from '../generated/prisma/client.js';

/** A detection ready to be stored: already rounded, and with its severity worked out. */
export interface NewDetection {
  id: string;
  severityLevelId: number;
  latitude: number;
  longitude: number;
  gpsAccuracyM?: number | undefined;
  confidence: number;
  bboxAreaRatio: number;
  detectedAt: Date;
}

/** How many detections a trip has, in all and by severity (every severity appears, even with 0). */
export interface TripDetectionCount {
  total: number;
  bySeverity: { severity: string; count: number }[];
}

/** Reads and writes the detections table. Every time comes from the caller, never from NOW(). */
export class DetectionRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Stores the detections of a trip in one statement and returns how many were new.
   *
   * A detection whose id already exists is skipped, not an error: the phone sends the same
   * batch again when an answer got lost, and the second time must change nothing. The ones
   * that were skipped are never overwritten, even if the repeated detection says something
   * different.
   */
  async insertMany(
    tripId: string,
    detections: readonly NewDetection[],
    now: Date,
  ): Promise<number> {
    if (detections.length === 0) {
      return 0;
    }
    const result = await this.db.detections.createMany({
      data: detections.map((detection) => ({
        id: detection.id,
        trip_id: tripId,
        severity_level_id: detection.severityLevelId,
        latitude: detection.latitude,
        longitude: detection.longitude,
        gps_accuracy_m: detection.gpsAccuracyM ?? null,
        model_confidence: detection.confidence,
        bbox_area_ratio: detection.bboxAreaRatio,
        detected_at: detection.detectedAt,
        received_at: now,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  /** The detections of a trip, counted in all and by severity, from the least to the most severe. */
  async countByTrip(tripId: string): Promise<TripDetectionCount> {
    const rows = await this.db.$queryRaw<{ severity: string; count: number }[]>`
      SELECT sl.name AS severity, COUNT(d.id)::int AS count
      FROM severity_levels sl
      LEFT JOIN detections d ON d.severity_level_id = sl.id AND d.trip_id = ${tripId}::uuid
      GROUP BY sl.id, sl.name, sl.min_area_ratio
      ORDER BY sl.min_area_ratio`;
    return {
      total: rows.reduce((sum, row) => sum + row.count, 0),
      bySeverity: rows.map((row) => ({ severity: row.severity, count: row.count })),
    };
  }
}

export const detectionRepository = new DetectionRepository();

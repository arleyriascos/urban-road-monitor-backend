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
}

export const detectionRepository = new DetectionRepository();

import { prisma } from '../config/database.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { TripCursor } from '../trips/cursor.js';
import { isUuid } from '../trips/uuid.js';

/** A trip: from the moment the camera starts until it stops. */
export interface TripRecord {
  id: string;
  userId: string;
  deviceId: string;
  aiModelId: number;
  startedAt: Date;
  endedAt: Date | null;
  framesAnalyzed: number;
  distanceM: number;
}

export interface NewTrip {
  userId: string;
  deviceId: string;
  aiModelId: number;
  startedAt: Date;
}

interface TripRow {
  id: string;
  user_id: string;
  device_id: string;
  ai_model_id: number;
  started_at: Date;
  ended_at: Date | null;
  frames_analyzed: number;
  distance_m: { toString(): string } | number;
}

/** A trip of the list of a person: the trip, its device, its model and how many detections it has. */
export interface TripSummary {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  framesAnalyzed: number;
  distanceM: number;
  detectionCount: number;
  platform: string;
  deviceLabel: string | null;
  modelVersion: string;
}

interface RawSummaryRow {
  id: string;
  started_at: Date;
  ended_at: Date | null;
  frames_analyzed: number;
  distance_m: number;
  detection_count: number;
  platform: string;
  label: string | null;
  model_version: string;
}

export interface TripEnd {
  endedAt: Date;
  framesAnalyzed: number;
  distanceM: number;
}

export function toTripRecord(row: TripRow): TripRecord {
  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id,
    aiModelId: row.ai_model_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    framesAnalyzed: row.frames_analyzed,
    distanceM: Number(row.distance_m),
  };
}

/** Reads and writes the trips table. Every time comes from the caller, never from NOW(). */
export class TripRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async create(trip: NewTrip): Promise<TripRecord> {
    const row = await this.db.trips.create({
      data: {
        user_id: trip.userId,
        device_id: trip.deviceId,
        ai_model_id: trip.aiModelId,
        started_at: trip.startedAt,
      },
    });
    return toTripRecord(row);
  }

  /**
   * A trip of this person, or null. A trip of someone else and a trip that does not exist look
   * the same, so nobody can find out which trip ids exist.
   */
  async findOwned(userId: string, tripId: string): Promise<TripRecord | null> {
    if (!isUuid(tripId)) {
      return null;
    }
    const row = await this.db.trips.findFirst({ where: { id: tripId, user_id: userId } });
    return row ? toTripRecord(row) : null;
  }

  /**
   * The trips of a person, newest first, at most `limit` of them. With a cursor, only the trips
   * that come after it. The order is the one of the index (user, start, id), and the id breaks
   * the ties, so no trip is skipped or repeated between pages.
   */
  async listByUser(
    userId: string,
    limit: number,
    after: TripCursor | null,
  ): Promise<TripSummary[]> {
    const rows = await this.db.$queryRaw<RawSummaryRow[]>`
      SELECT t.id::text AS id,
             t.started_at,
             t.ended_at,
             t.frames_analyzed::int AS frames_analyzed,
             t.distance_m::float8 AS distance_m,
             (SELECT COUNT(*)::int FROM detections x WHERE x.trip_id = t.id) AS detection_count,
             d.platform,
             d.label,
             m.version AS model_version
      FROM trips t
      JOIN devices d ON d.id = t.device_id
      JOIN ai_models m ON m.id = t.ai_model_id
      WHERE t.user_id = ${userId}::uuid
        AND (${after === null}::boolean
             OR (t.started_at, t.id) < (${after?.startedAt ?? new Date(0)}::timestamptz,
                                        ${after?.id ?? '00000000-0000-0000-0000-000000000000'}::uuid))
      ORDER BY t.started_at DESC, t.id DESC
      LIMIT ${limit}`;
    return rows.map((row) => ({
      id: row.id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      framesAnalyzed: row.frames_analyzed,
      distanceM: row.distance_m,
      detectionCount: row.detection_count,
      platform: row.platform,
      deviceLabel: row.label,
      modelVersion: row.model_version,
    }));
  }

  /**
   * Closes an open trip of this person with its counters. It returns the trip as it is now, or
   * null if there is nothing to close: the trip is not theirs, does not exist, or was already
   * closed. A trip is closed only once, so its numbers cannot be rewritten later.
   */
  async finish(userId: string, tripId: string, end: TripEnd): Promise<TripRecord | null> {
    if (!isUuid(tripId)) {
      return null;
    }
    const result = await this.db.trips.updateMany({
      where: { id: tripId, user_id: userId, ended_at: null },
      data: {
        ended_at: end.endedAt,
        frames_analyzed: end.framesAnalyzed,
        distance_m: end.distanceM,
      },
    });
    return result.count === 0 ? null : this.findOwned(userId, tripId);
  }
}

export const tripRepository = new TripRepository();

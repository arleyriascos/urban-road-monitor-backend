import { prisma } from '../config/database.js';
import type { PrismaClient } from '../generated/prisma/client.js';
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

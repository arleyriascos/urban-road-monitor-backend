import { prisma } from '../config/database.js';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type { CleanupTrip } from '../trips/cleanup-plan.js';

interface RawCleanupTrip {
  id: string;
  started_at: Date;
  ended_at: Date | null;
  detection_count: number;
  detections_in_potholes: number;
}

/** What a deletion removed. */
export interface CleanupResult {
  trips: number;
  detections: number;
}

/** The queries of npm run trips:cleanup. It is the only place that deletes trips. */
export class TripCleanupRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  /** The account with that email (lowercase), or null. */
  async findAccount(email: string): Promise<{ id: string; email: string } | null> {
    const user = await this.db.users.findUnique({ where: { email } });
    return user ? { id: user.id, email: user.email } : null;
  }

  /** The trips of the account, oldest first, from `since` on when it is given. */
  async listTrips(userId: string, since: Date | null): Promise<CleanupTrip[]> {
    const rows = await this.db.$queryRaw<RawCleanupTrip[]>`
      SELECT t.id::text AS id,
             t.started_at,
             t.ended_at,
             COUNT(d.id)::int AS detection_count,
             COUNT(d.pothole_id)::int AS detections_in_potholes
      FROM trips t
      LEFT JOIN detections d ON d.trip_id = t.id
      WHERE t.user_id = ${userId}::uuid
        AND (${since === null}::boolean OR t.started_at >= ${since ?? new Date(0)}::timestamptz)
      GROUP BY t.id
      ORDER BY t.started_at, t.id`;
    return rows.map((row) => ({
      id: row.id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      detectionCount: row.detection_count,
      detectionsInPotholes: row.detections_in_potholes,
    }));
  }

  /**
   * Deletes these trips of the account with their detections, all or nothing. The check is made
   * again here, inside the transaction: a trip that got a detection in a pothole after the plan
   * was made is left alone, and a trip of someone else is never touched.
   */
  async deleteTrips(userId: string, tripIds: readonly string[]): Promise<CleanupResult> {
    if (tripIds.length === 0) {
      return { trips: 0, detections: 0 };
    }
    return this.db.$transaction(async (tx) => {
      // The trips that really can go: of this account, and with no detection in a pothole.
      const allowed = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT t.id::text AS id
        FROM trips t
        WHERE t.id = ANY(${[...tripIds]}::uuid[])
          AND t.user_id = ${userId}::uuid
          AND NOT EXISTS (SELECT 1 FROM detections d WHERE d.trip_id = t.id AND d.pothole_id IS NOT NULL)
        FOR UPDATE`);
      const ids = allowed.map((row) => row.id);
      if (ids.length === 0) {
        return { trips: 0, detections: 0 };
      }
      const detections = await tx.$executeRaw`
        DELETE FROM detections WHERE trip_id = ANY(${ids}::uuid[])`;
      const trips = await tx.$executeRaw`
        DELETE FROM trips WHERE id = ANY(${ids}::uuid[])`;
      return { trips, detections };
    });
  }
}

export const tripCleanupRepository = new TripCleanupRepository();

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  createTestClient,
  createTestUser,
  resetDatabase,
  testDatabaseUrl,
} from '../test/test-database.js';
import { TripCleanupRepository } from './trip-cleanup.repository.js';

/** The queries of the cleanup of trips, against a real PostgreSQL. */
const url = testDatabaseUrl();

describe.skipIf(!url)('TripCleanupRepository (real database)', () => {
  let db: PrismaClient;
  let repository: TripCleanupRepository;
  let modelId: number;
  let severityId: number;
  let statusId: number;
  let userId: string;
  let deviceId: string;
  let counter = 0;

  beforeAll(async () => {
    db = createTestClient(url!);
    repository = new TripCleanupRepository(db);
    modelId = (await db.ai_models.findFirstOrThrow({ where: { is_active: true } })).id;
    severityId = (await db.severity_levels.findFirstOrThrow()).id;
    statusId = (await db.pothole_statuses.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
    // Potholes do not hang from users: the ones this file makes are removed with a clean slate.
    await db.$executeRawUnsafe('DELETE FROM potholes');
    userId = await createTestUser(db);
    deviceId = await newDevice(userId);
  });

  async function newDevice(owner: string): Promise<string> {
    return (await db.devices.create({ data: { user_id: owner, platform: 'android' } })).id;
  }

  async function newTrip(owner: string, device: string, startedAt: string, detections: number) {
    const trip = await db.trips.create({
      data: {
        user_id: owner,
        device_id: device,
        ai_model_id: modelId,
        started_at: new Date(startedAt),
      },
    });
    for (let i = 0; i < detections; i += 1) {
      counter += 1;
      await db.detections.create({
        data: {
          trip_id: trip.id,
          severity_level_id: severityId,
          latitude: 1.2136,
          longitude: -77.2811,
          model_confidence: 0.8,
          bbox_area_ratio: 0.02,
          detected_at: new Date(startedAt),
          id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
        },
      });
    }
    return trip.id;
  }

  async function putInPothole(tripId: string) {
    const pothole = await db.potholes.create({
      data: {
        latitude: 1.2136,
        longitude: -77.2811,
        severity_level_id: severityId,
        status_id: statusId,
        first_detected_at: new Date('2026-11-16T10:00:00Z'),
        last_detected_at: new Date('2026-11-16T10:00:00Z'),
      },
    });
    await db.detections.updateMany({
      where: { trip_id: tripId },
      data: { pothole_id: pothole.id },
    });
  }

  it('finds an account by its email and says null for one that does not exist', async () => {
    const user = await db.users.findUniqueOrThrow({ where: { id: userId } });

    expect(await repository.findAccount(user.email)).toEqual({ id: userId, email: user.email });
    expect(await repository.findAccount('nadie@example.com')).toBeNull();
  });

  it('lists the trips of the account, oldest first, with their detections', async () => {
    const early = await newTrip(userId, deviceId, '2026-11-15T10:00:00Z', 2);
    const late = await newTrip(userId, deviceId, '2026-11-16T10:00:00Z', 3);
    await putInPothole(late);

    const all = await repository.listTrips(userId, null);

    expect(all.map((trip) => [trip.id, trip.detectionCount, trip.detectionsInPotholes])).toEqual([
      [early, 2, 0],
      [late, 3, 3],
    ]);
  });

  it('lists only from the day asked', async () => {
    await newTrip(userId, deviceId, '2026-11-15T10:00:00Z', 1);
    const late = await newTrip(userId, deviceId, '2026-11-16T10:00:00Z', 1);

    const since = await repository.listTrips(userId, new Date('2026-11-16T05:00:00Z'));

    expect(since.map((trip) => trip.id)).toEqual([late]);
  });

  it('shows a trip with no detections too', async () => {
    const empty = await newTrip(userId, deviceId, '2026-11-16T10:00:00Z', 0);

    expect((await repository.listTrips(userId, null)).map((trip) => trip.id)).toEqual([empty]);
  });

  it('deletes the trips with their detections and counts what went', async () => {
    const one = await newTrip(userId, deviceId, '2026-11-16T10:00:00Z', 2);
    const two = await newTrip(userId, deviceId, '2026-11-16T11:00:00Z', 3);
    const keep = await newTrip(userId, deviceId, '2026-11-16T12:00:00Z', 1);

    const result = await repository.deleteTrips(userId, [one, two]);

    expect(result).toEqual({ trips: 2, detections: 5 });
    expect((await repository.listTrips(userId, null)).map((trip) => trip.id)).toEqual([keep]);
    expect(await db.detections.count()).toBe(1);
  });

  it('does not delete a trip with a detection in a pothole', async () => {
    const free = await newTrip(userId, deviceId, '2026-11-16T10:00:00Z', 1);
    const used = await newTrip(userId, deviceId, '2026-11-16T11:00:00Z', 2);
    await putInPothole(used);

    const result = await repository.deleteTrips(userId, [free, used]);

    expect(result).toEqual({ trips: 1, detections: 1 });
    expect((await repository.listTrips(userId, null)).map((trip) => trip.id)).toEqual([used]);
  });

  it('never deletes the trip of another account, even if its id is given', async () => {
    const other = await createTestUser(db);
    const trip = await newTrip(other, await newDevice(other), '2026-11-16T10:00:00Z', 2);

    const result = await repository.deleteTrips(userId, [trip]);

    expect(result).toEqual({ trips: 0, detections: 0 });
    expect(await db.trips.count()).toBe(1);
    expect(await db.detections.count()).toBe(2);
  });

  it('does nothing for an empty list', async () => {
    expect(await repository.deleteTrips(userId, [])).toEqual({ trips: 0, detections: 0 });
  });
});

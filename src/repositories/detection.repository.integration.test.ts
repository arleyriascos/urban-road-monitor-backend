import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  createTestClient,
  createTestUser,
  resetDatabase,
  testDatabaseUrl,
} from '../test/test-database.js';
import { DetectionRepository, type NewDetection } from './detection.repository.js';

/** These tests run against a real PostgreSQL; they are skipped without TEST_DATABASE_URL. */
const url = testDatabaseUrl();
const T0 = new Date('2026-11-16T12:00:00.000Z');

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

describe.skipIf(!url)('DetectionRepository (real database)', () => {
  let db: PrismaClient;
  let repository: DetectionRepository;
  let levelId: number;
  let tripId: string;

  beforeAll(async () => {
    db = createTestClient(url!);
    repository = new DetectionRepository(db);
    levelId = (await db.severity_levels.findFirstOrThrow({ where: { name: 'moderado' } })).id;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
    const userId = await createTestUser(db);
    const device = await db.devices.create({ data: { user_id: userId, platform: 'android' } });
    const model = await db.ai_models.findFirstOrThrow({ where: { is_active: true } });
    tripId = (
      await db.trips.create({
        data: { user_id: userId, device_id: device.id, ai_model_id: model.id, started_at: T0 },
      })
    ).id;
  });

  function detection(n: number, change: Partial<NewDetection> = {}): NewDetection {
    return {
      id: id(n),
      severityLevelId: levelId,
      latitude: 1.2136,
      longitude: -77.2811,
      gpsAccuracyM: 6.5,
      confidence: 0.82,
      bboxAreaRatio: 0.0311,
      detectedAt: new Date(T0.getTime() + n * 1000),
      ...change,
    };
  }

  it('stores a batch with the id the phone chose and the time it arrived', async () => {
    const arrival = new Date('2026-11-16T12:05:00Z');

    const stored = await repository.insertMany(tripId, [detection(1), detection(2)], arrival);

    expect(stored).toBe(2);
    const row = await db.detections.findUniqueOrThrow({ where: { id: id(1) } });
    expect(row).toMatchObject({ trip_id: tripId, severity_level_id: levelId, pothole_id: null });
    expect(Number(row.latitude)).toBe(1.2136);
    expect(Number(row.gps_accuracy_m)).toBe(6.5);
    expect(Number(row.model_confidence)).toBe(0.82);
    expect(Number(row.bbox_area_ratio)).toBe(0.0311);
    expect(row.detected_at.toISOString()).toBe('2026-11-16T12:00:01.000Z');
    expect(row.received_at.toISOString()).toBe(arrival.toISOString());
  });

  it('stores a detection without GPS accuracy as null', async () => {
    await repository.insertMany(tripId, [detection(1, { gpsAccuracyM: undefined })], T0);

    expect(
      (await db.detections.findUniqueOrThrow({ where: { id: id(1) } })).gps_accuracy_m,
    ).toBeNull();
  });

  it('stores nothing for an empty list', async () => {
    expect(await repository.insertMany(tripId, [], T0)).toBe(0);
  });

  it('sending the same batch again stores nothing new', async () => {
    await repository.insertMany(tripId, [detection(1), detection(2)], T0);

    const again = await repository.insertMany(tripId, [detection(1), detection(2)], T0);

    expect(again).toBe(0);
    expect(await db.detections.count()).toBe(2);
  });

  it('stores the new ones of a batch that repeats some, and never rewrites the old ones', async () => {
    await repository.insertMany(tripId, [detection(1)], T0);

    const stored = await repository.insertMany(
      tripId,
      [detection(1, { confidence: 0.99 }), detection(2)],
      T0,
    );

    expect(stored).toBe(1);
    expect(
      Number((await db.detections.findUniqueOrThrow({ where: { id: id(1) } })).model_confidence),
    ).toBe(0.82);
  });

  it('refuses a trip that does not exist, and stores none of the batch', async () => {
    await expect(
      repository.insertMany('00000000-0000-4000-8000-0000000000ff', [detection(1)], T0),
    ).rejects.toThrow();
    expect(await db.detections.count()).toBe(0);
  });

  it('stores a full batch of 100', async () => {
    const batch = Array.from({ length: 100 }, (_, i) => detection(i + 1));

    expect(await repository.insertMany(tripId, batch, T0)).toBe(100);
  });
});

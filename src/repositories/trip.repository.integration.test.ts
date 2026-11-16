import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  createTestClient,
  createTestUser,
  resetDatabase,
  testDatabaseUrl,
} from '../test/test-database.js';
import { TripRepository } from './trip.repository.js';

/** These tests run against a real PostgreSQL; they are skipped without TEST_DATABASE_URL. */
const url = testDatabaseUrl();
const T0 = new Date('2026-11-16T12:00:00.000Z');

describe.skipIf(!url)('TripRepository (real database)', () => {
  let db: PrismaClient;
  let repository: TripRepository;
  let modelId: number;

  beforeAll(async () => {
    db = createTestClient(url!);
    repository = new TripRepository(db);
    modelId = (await db.ai_models.findFirstOrThrow({ where: { is_active: true } })).id;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
  });

  async function newDevice(userId: string): Promise<string> {
    const device = await db.devices.create({ data: { user_id: userId, platform: 'android' } });
    return device.id;
  }

  describe('create', () => {
    it('stores an open trip with empty counters', async () => {
      const userId = await createTestUser(db);
      const deviceId = await newDevice(userId);

      const trip = await repository.create({ userId, deviceId, aiModelId: modelId, startedAt: T0 });

      expect(trip).toMatchObject({
        userId,
        deviceId,
        aiModelId: modelId,
        endedAt: null,
        framesAnalyzed: 0,
        distanceM: 0,
      });
      expect(trip.startedAt.toISOString()).toBe(T0.toISOString());
      expect(trip.id).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('finish', () => {
    const END = new Date('2026-11-16T12:30:00.000Z');

    async function openTrip(userId: string) {
      const deviceId = await newDevice(userId);
      return repository.create({ userId, deviceId, aiModelId: modelId, startedAt: T0 });
    }

    it('closes an open trip and keeps its counters', async () => {
      const userId = await createTestUser(db);
      const trip = await openTrip(userId);

      const closed = await repository.finish(userId, trip.id, {
        endedAt: END,
        framesAnalyzed: 7200,
        distanceM: 4210.55,
      });

      expect(closed).toMatchObject({ id: trip.id, framesAnalyzed: 7200, distanceM: 4210.55 });
      expect(closed?.endedAt?.toISOString()).toBe(END.toISOString());
    });

    it('closes a trip only once: the second end changes nothing', async () => {
      const userId = await createTestUser(db);
      const trip = await openTrip(userId);
      await repository.finish(userId, trip.id, {
        endedAt: END,
        framesAnalyzed: 10,
        distanceM: 100,
      });

      const again = await repository.finish(userId, trip.id, {
        endedAt: new Date('2026-11-16T13:00:00Z'),
        framesAnalyzed: 99,
        distanceM: 999,
      });

      expect(again).toBeNull();
      expect(await repository.findOwned(userId, trip.id)).toMatchObject({
        framesAnalyzed: 10,
        distanceM: 100,
      });
    });

    it('does not close the trip of someone else', async () => {
      const owner = await createTestUser(db);
      const stranger = await createTestUser(db);
      const trip = await openTrip(owner);

      expect(
        await repository.finish(stranger, trip.id, {
          endedAt: END,
          framesAnalyzed: 1,
          distanceM: 1,
        }),
      ).toBeNull();
      expect((await repository.findOwned(owner, trip.id))?.endedAt).toBeNull();
    });

    it('answers null for an id that is not a UUID', async () => {
      const userId = await createTestUser(db);

      expect(
        await repository.finish(userId, 'nope', { endedAt: END, framesAnalyzed: 1, distanceM: 1 }),
      ).toBeNull();
    });

    it('lets the table refuse an end before the start', async () => {
      const userId = await createTestUser(db);
      const trip = await openTrip(userId);

      await expect(
        repository.finish(userId, trip.id, {
          endedAt: new Date('2026-11-16T11:00:00Z'),
          framesAnalyzed: 1,
          distanceM: 1,
        }),
      ).rejects.toThrow();
    });
  });

  describe('listByUser', () => {
    async function tripAt(userId: string, deviceId: string, minute: number) {
      return repository.create({
        userId,
        deviceId,
        aiModelId: modelId,
        startedAt: new Date(T0.getTime() + minute * 60_000),
      });
    }

    it('lists the trips of the person, newest first, with their device and model', async () => {
      const userId = await createTestUser(db);
      const deviceId = (
        await db.devices.create({ data: { user_id: userId, platform: 'ios', label: 'Mi iPhone' } })
      ).id;
      const first = await tripAt(userId, deviceId, 0);
      const second = await tripAt(userId, deviceId, 60);

      const list = await repository.listByUser(userId, 10, null);

      expect(list.map((trip) => trip.id)).toEqual([second.id, first.id]);
      expect(list[0]).toMatchObject({
        platform: 'ios',
        deviceLabel: 'Mi iPhone',
        modelVersion: '1.0.0',
        endedAt: null,
        detectionCount: 0,
      });
    });

    it('counts the detections of each trip', async () => {
      const userId = await createTestUser(db);
      const deviceId = await newDevice(userId);
      const trip = await tripAt(userId, deviceId, 0);
      const level = await db.severity_levels.findFirstOrThrow();
      await db.detections.createMany({
        data: [1, 2, 3].map((n) => ({
          trip_id: trip.id,
          severity_level_id: level.id,
          latitude: 1.2 + n / 1000,
          longitude: -77.3,
          model_confidence: 0.7,
          bbox_area_ratio: 0.02,
          detected_at: T0,
        })),
      });

      expect((await repository.listByUser(userId, 10, null))[0]?.detectionCount).toBe(3);
    });

    it('does not list the trips of other people', async () => {
      const one = await createTestUser(db);
      const two = await createTestUser(db);
      await tripAt(one, await newDevice(one), 0);

      expect(await repository.listByUser(two, 10, null)).toEqual([]);
    });

    it('pages with the cursor without skipping or repeating a trip, even with equal start times', async () => {
      const userId = await createTestUser(db);
      const deviceId = await newDevice(userId);
      const created = [];
      for (const minute of [0, 10, 10, 10, 20, 30, 30]) {
        created.push(await tripAt(userId, deviceId, minute));
      }

      const seen: string[] = [];
      let cursor = null;
      for (let page = 0; page < 10; page += 1) {
        const rows = await repository.listByUser(userId, 3, cursor);
        if (rows.length === 0) {
          break;
        }
        seen.push(...rows.map((row) => row.id));
        const last = rows[rows.length - 1]!;
        cursor = { startedAt: last.startedAt, id: last.id };
      }

      expect(seen).toHaveLength(created.length);
      expect(new Set(seen).size).toBe(created.length);
      const all = await repository.listByUser(userId, 100, null);
      expect(seen).toEqual(all.map((row) => row.id));
    });
  });

  describe('findOwned', () => {
    it('finds a trip of the person', async () => {
      const userId = await createTestUser(db);
      const deviceId = await newDevice(userId);
      const trip = await repository.create({ userId, deviceId, aiModelId: modelId, startedAt: T0 });

      expect(await repository.findOwned(userId, trip.id)).toEqual(trip);
    });

    it('does not find the trip of someone else, as if it did not exist', async () => {
      const owner = await createTestUser(db);
      const stranger = await createTestUser(db);
      const trip = await repository.create({
        userId: owner,
        deviceId: await newDevice(owner),
        aiModelId: modelId,
        startedAt: T0,
      });

      expect(await repository.findOwned(stranger, trip.id)).toBeNull();
    });

    it('does not find a trip that does not exist or an id that is not a UUID', async () => {
      const userId = await createTestUser(db);

      expect(await repository.findOwned(userId, '00000000-0000-4000-8000-000000000000')).toBeNull();
      expect(await repository.findOwned(userId, 'not-a-uuid')).toBeNull();
    });
  });
});

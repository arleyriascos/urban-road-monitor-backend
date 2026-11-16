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

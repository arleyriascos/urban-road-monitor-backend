import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  createTestClient,
  createTestUser,
  resetDatabase,
  testDatabaseUrl,
} from '../test/test-database.js';
import { DeviceRepository, MAX_DEVICES_PER_USER } from './device.repository.js';

/** These tests run against a real PostgreSQL; they are skipped without TEST_DATABASE_URL. */
const url = testDatabaseUrl();
const T0 = new Date('2026-11-16T12:00:00.000Z');
const minutes = (count: number) => new Date(T0.getTime() + count * 60_000);

describe.skipIf(!url)('DeviceRepository (real database)', () => {
  let db: PrismaClient;
  let repository: DeviceRepository;

  beforeAll(() => {
    db = createTestClient(url!);
    repository = new DeviceRepository(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
  });

  it('creates a device the first time and stores what the phone said', async () => {
    const userId = await createTestUser(db);

    const device = await repository.findOrCreate(
      userId,
      { platform: 'android', browser: 'Chrome 142', label: 'Mi Android' },
      T0,
    );

    expect(device.created).toBe(true);
    const row = await db.devices.findUniqueOrThrow({ where: { id: device.id } });
    expect(row).toMatchObject({
      user_id: userId,
      platform: 'android',
      browser: 'Chrome 142',
      label: 'Mi Android',
    });
    expect(row.last_seen_at.toISOString()).toBe(T0.toISOString());
  });

  it('finds the same device the next time and moves last_seen_at', async () => {
    const userId = await createTestUser(db);
    const first = await repository.findOrCreate(userId, { platform: 'ios', browser: 'Safari' }, T0);

    const second = await repository.findOrCreate(
      userId,
      { platform: 'ios', browser: 'Safari' },
      minutes(30),
    );

    expect(second).toEqual({ id: first.id, created: false });
    expect(await db.devices.count({ where: { user_id: userId } })).toBe(1);
    const row = await db.devices.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.last_seen_at.toISOString()).toBe(minutes(30).toISOString());
  });

  it('tells apart a missing browser from an empty match: null equals null', async () => {
    const userId = await createTestUser(db);
    const a = await repository.findOrCreate(userId, { platform: 'other' }, T0);
    const b = await repository.findOrCreate(userId, { platform: 'other' }, minutes(1));
    const c = await repository.findOrCreate(
      userId,
      { platform: 'other', browser: 'Firefox' },
      minutes(2),
    );

    expect(b.id).toBe(a.id);
    expect(c.id).not.toBe(a.id);
  });

  it('keeps the devices of two people apart', async () => {
    const one = await createTestUser(db);
    const two = await createTestUser(db);

    const a = await repository.findOrCreate(one, { platform: 'android' }, T0);
    const b = await repository.findOrCreate(two, { platform: 'android' }, T0);

    expect(a.id).not.toBe(b.id);
  });

  it('reuses the device seen longest ago when the person already has the maximum', async () => {
    const userId = await createTestUser(db);
    for (let n = 0; n < MAX_DEVICES_PER_USER; n += 1) {
      await repository.findOrCreate(
        userId,
        { platform: 'android', label: `Phone ${n}` },
        minutes(n),
      );
    }
    const oldest = await db.devices.findFirstOrThrow({
      where: { user_id: userId, label: 'Phone 0' },
    });

    const device = await repository.findOrCreate(
      userId,
      { platform: 'ios', label: 'A new one' },
      minutes(100),
    );

    expect(device).toEqual({ id: oldest.id, created: false });
    expect(await db.devices.count({ where: { user_id: userId } })).toBe(MAX_DEVICES_PER_USER);
    const row = await db.devices.findUniqueOrThrow({ where: { id: oldest.id } });
    expect(row).toMatchObject({ platform: 'ios', label: 'A new one' });
  });

  it('creates one device when two trips start at the same moment', async () => {
    const userId = await createTestUser(db);

    const results = await Promise.all([
      repository.findOrCreate(userId, { platform: 'android', label: 'Mi Android' }, T0),
      repository.findOrCreate(userId, { platform: 'android', label: 'Mi Android' }, T0),
    ]);

    expect(results[0].id).toBe(results[1].id);
    expect(await db.devices.count({ where: { user_id: userId } })).toBe(1);
  });
});

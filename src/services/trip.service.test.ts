import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error.js';
import type { TripRecord, TripSummary } from '../repositories/trip.repository.js';
import { DEFAULT_MAX_GPS_ACCURACY_M, TripService } from './trip.service.js';

const NOW = new Date('2026-11-16T12:00:00Z');
const MODEL = { id: 7, name: 'YOLOv8n Baches', version: '1.0.0', minConfidence: 0.4 };

function tripRecord(change: Partial<TripRecord> = {}): TripRecord {
  return {
    id: 'trip-1',
    userId: 'user-1',
    deviceId: 'device-1',
    aiModelId: MODEL.id,
    startedAt: NOW,
    endedAt: null,
    framesAnalyzed: 0,
    distanceM: 0,
    ...change,
  };
}

function setup(overrides: { model?: typeof MODEL | null; accuracy?: number } = {}) {
  const models = {
    findActive: vi.fn(async () => (overrides.model === undefined ? MODEL : overrides.model)),
  };
  const devices = { findOrCreate: vi.fn(async () => ({ id: 'device-1', created: true })) };
  const stored = new Map<string, TripRecord>();
  const trips = {
    create: vi.fn(async (input: { startedAt: Date }) => {
      const record = tripRecord({ startedAt: input.startedAt });
      stored.set(record.id, record);
      return record;
    }),
    findOwned: vi.fn(async (userId: string, tripId: string) => {
      const record = stored.get(tripId);
      return record && record.userId === userId ? record : null;
    }),
    listByUser: vi.fn(
      async (
        _userId: string,
        _limit: number,
        _after: { startedAt: Date; id: string } | null,
      ): Promise<TripSummary[]> => [],
    ),
    finish: vi.fn(
      async (
        userId: string,
        tripId: string,
        end: { endedAt: Date; framesAnalyzed: number; distanceM: number },
      ) => {
        const record = stored.get(tripId);
        if (!record || record.userId !== userId || record.endedAt !== null) {
          return null;
        }
        const closed = { ...record, ...end };
        stored.set(tripId, closed);
        return closed;
      },
    ),
  };
  const detections = {
    countByTrip: vi.fn(async () => ({
      total: 5,
      bySeverity: [{ severity: 'leve', count: 5 }],
    })),
  };
  const parameters = {
    getNumber: vi.fn(async (_key: string, fallback: number) => overrides.accuracy ?? fallback),
  };
  const service = new TripService({
    models,
    devices,
    trips,
    detections,
    parameters,
    clock: () => NOW,
  });
  return { service, models, devices, trips, detections, parameters, stored };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TripService.start', () => {
  it('starts a trip on the device of the phone with the active model', async () => {
    const { service, devices, trips } = setup();

    const started = await service.start('user-1', {
      device: { platform: 'android', browser: 'Chrome 142' },
      modelVersion: '1.0.0',
    });

    expect(devices.findOrCreate).toHaveBeenCalledWith(
      'user-1',
      { platform: 'android', browser: 'Chrome 142' },
      NOW,
    );
    expect(trips.create).toHaveBeenCalledWith({
      userId: 'user-1',
      deviceId: 'device-1',
      aiModelId: 7,
      startedAt: NOW,
    });
    expect(started).toEqual({
      tripId: 'trip-1',
      deviceId: 'device-1',
      startedAt: NOW,
      model: { version: '1.0.0', minConfidence: 0.4 },
      limits: { maxGpsAccuracyM: DEFAULT_MAX_GPS_ACCURACY_M, maxBatchSize: 100 },
    });
  });

  it('tells the phone the GPS accuracy limit of the table of parameters', async () => {
    const { service } = setup({ accuracy: 12 });

    const started = await service.start('user-1', {
      device: { platform: 'ios' },
      modelVersion: '1.0.0',
    });

    expect(started.limits.maxGpsAccuracyM).toBe(12);
  });

  it('believes the start time of the phone when it makes sense, and not when it does not', async () => {
    const { service, trips } = setup();
    const tenMinutesAgo = new Date(NOW.getTime() - 600_000);

    await service.start('user-1', {
      device: { platform: 'ios' },
      modelVersion: '1.0.0',
      startedAt: tenMinutesAgo,
    });
    await service.start('user-1', {
      device: { platform: 'ios' },
      modelVersion: '1.0.0',
      startedAt: new Date('2030-01-01T00:00:00Z'),
    });

    expect(trips.create.mock.calls.map(([input]) => input.startedAt)).toEqual([tenMinutesAgo, NOW]);
  });

  it('refuses a phone that runs another model and says which one to use', async () => {
    const { service, devices, trips } = setup();

    const error = await service
      .start('user-1', { device: { platform: 'android' }, modelVersion: '0.9.0' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      statusCode: 409,
      code: 'MODEL_VERSION_MISMATCH',
      details: { expected: '1.0.0', received: '0.9.0' },
    });
    expect(devices.findOrCreate).not.toHaveBeenCalled();
    expect(trips.create).not.toHaveBeenCalled();
  });

  it('answers 503 when no model is active', async () => {
    const { service } = setup({ model: null });

    await expect(
      service.start('user-1', { device: { platform: 'android' }, modelVersion: '1.0.0' }),
    ).rejects.toMatchObject({ statusCode: 503, code: 'NO_ACTIVE_MODEL' });
  });

  it('answers 503 when the database fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { service, trips } = setup();
    trips.create.mockRejectedValue(new Error('connection reset'));

    await expect(
      service.start('user-1', { device: { platform: 'android' }, modelVersion: '1.0.0' }),
    ).rejects.toMatchObject({ statusCode: 503, code: 'DATABASE_UNAVAILABLE' });
  });
});

describe('TripService.finish', () => {
  const END = { framesAnalyzed: 7200, distanceM: 4210.55 };
  const later = (ms: number) => new Date(NOW.getTime() + ms);

  async function startedTrip(ctx: ReturnType<typeof setup>) {
    return ctx.service.start('user-1', { device: { platform: 'android' }, modelVersion: '1.0.0' });
  }

  it('closes the trip with its counters and answers it with its detections', async () => {
    const ctx = setup();
    const { tripId } = await startedTrip(ctx);

    const closed = await ctx.service.finish('user-1', tripId, END);

    expect(closed).toMatchObject({ id: tripId, framesAnalyzed: 7200, distanceM: 4210.55 });
    expect(closed.endedAt).toEqual(NOW);
    expect(closed.detections.total).toBe(5);
  });

  it('believes the end time of the phone when it falls inside the trip', async () => {
    const ctx = setup();
    const { tripId } = await startedTrip(ctx);
    ctx.stored.set(tripId, { ...ctx.stored.get(tripId)!, startedAt: later(-3_600_000) });

    const closed = await ctx.service.finish('user-1', tripId, {
      ...END,
      endedAt: later(-60_000),
    });

    expect(closed.endedAt).toEqual(later(-60_000));
  });

  it('answers the same trip when it is sent twice, without rewriting its numbers', async () => {
    const ctx = setup();
    const { tripId } = await startedTrip(ctx);
    await ctx.service.finish('user-1', tripId, END);

    const again = await ctx.service.finish('user-1', tripId, { framesAnalyzed: 1, distanceM: 1 });

    expect(again).toMatchObject({ framesAnalyzed: 7200, distanceM: 4210.55 });
    expect(ctx.trips.finish).toHaveBeenCalledTimes(1);
  });

  it('says "not found" for the trip of someone else, as for one that does not exist', async () => {
    const ctx = setup();
    const { tripId } = await startedTrip(ctx);

    await expect(ctx.service.finish('user-2', tripId, END)).rejects.toMatchObject({
      statusCode: 404,
      code: 'TRIP_NOT_FOUND',
    });
    await expect(ctx.service.finish('user-1', 'nope', END)).rejects.toMatchObject({
      statusCode: 404,
      code: 'TRIP_NOT_FOUND',
    });
  });

  it('answers the stored trip when another request closed it first', async () => {
    const ctx = setup();
    const { tripId } = await startedTrip(ctx);
    ctx.trips.finish.mockImplementationOnce(async () => {
      ctx.stored.set(tripId, {
        ...ctx.stored.get(tripId)!,
        endedAt: later(1000),
        framesAnalyzed: 50,
        distanceM: 500,
      });
      return null;
    });

    const closed = await ctx.service.finish('user-1', tripId, END);

    expect(closed).toMatchObject({ framesAnalyzed: 50, distanceM: 500 });
  });
});

function summary(n: number): TripSummary {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    startedAt: new Date(NOW.getTime() - n * 60_000),
    endedAt: null,
    framesAnalyzed: 0,
    distanceM: 0,
    detectionCount: n,
    platform: 'android',
    deviceLabel: null,
    modelVersion: '1.0.0',
  };
}

describe('TripService.list', () => {
  it('answers a page and no cursor when everything fits', async () => {
    const ctx = setup();
    ctx.trips.listByUser.mockResolvedValue([summary(1), summary(2)]);

    const page = await ctx.service.list('user-1', 5, undefined);

    expect(page.trips).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
    expect(ctx.trips.listByUser).toHaveBeenCalledWith('user-1', 6, null);
  });

  it('asks for one more trip than the page and answers a cursor that points after the last', async () => {
    const ctx = setup();
    ctx.trips.listByUser.mockResolvedValue([summary(1), summary(2), summary(3)]);

    const page = await ctx.service.list('user-1', 2, undefined);

    expect(page.trips.map((trip) => trip.detectionCount)).toEqual([1, 2]);
    expect(page.nextCursor).not.toBeNull();

    await ctx.service.list('user-1', 2, page.nextCursor ?? undefined);
    const [, , cursor] = ctx.trips.listByUser.mock.calls[1]!;
    expect(cursor).toEqual({ startedAt: summary(2).startedAt, id: summary(2).id });
  });

  it('refuses a cursor it did not make', async () => {
    const ctx = setup();

    await expect(ctx.service.list('user-1', 5, 'made-up')).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_CURSOR',
    });
    expect(ctx.trips.listByUser).not.toHaveBeenCalled();
  });
});

describe('TripService.get', () => {
  it('answers one trip of the person with its detections', async () => {
    const ctx = setup();
    const { tripId } = await ctx.service.start('user-1', {
      device: { platform: 'ios' },
      modelVersion: '1.0.0',
    });

    expect(await ctx.service.get('user-1', tripId)).toMatchObject({
      id: tripId,
      detections: { total: 5 },
    });
  });

  it('does not answer the trip of someone else', async () => {
    const ctx = setup();
    const { tripId } = await ctx.service.start('user-1', {
      device: { platform: 'ios' },
      modelVersion: '1.0.0',
    });

    await expect(ctx.service.get('user-2', tripId)).rejects.toMatchObject({
      statusCode: 404,
      code: 'TRIP_NOT_FOUND',
    });
  });
});

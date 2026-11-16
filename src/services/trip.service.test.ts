import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error.js';
import type { TripRecord } from '../repositories/trip.repository.js';
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
  const trips = {
    create: vi.fn(async (input: { startedAt: Date }) => tripRecord({ startedAt: input.startedAt })),
  };
  const parameters = {
    getNumber: vi.fn(async (_key: string, fallback: number) => overrides.accuracy ?? fallback),
  };
  const service = new TripService({ models, devices, trips, parameters, clock: () => NOW });
  return { service, models, devices, trips, parameters };
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

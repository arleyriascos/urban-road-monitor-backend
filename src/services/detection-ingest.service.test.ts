import { describe, expect, it, vi } from 'vitest';
import { DetectionIngestService } from './detection-ingest.service.js';
import type { TripRecord } from '../repositories/trip.repository.js';
import type { DetectionInput } from '../detections/detection-input.js';
import type { NewDetection } from '../repositories/detection.repository.js';

const NOW = new Date('2026-11-16T12:00:00.000Z');
const TRIP_ID = '11111111-1111-4111-8111-111111111111';
const LEVELS = [
  { id: 1, name: 'leve', minAreaRatio: 0, maxAreaRatio: 0.01 },
  { id: 2, name: 'moderado', minAreaRatio: 0.01, maxAreaRatio: 0.04 },
  { id: 3, name: 'grave', minAreaRatio: 0.04, maxAreaRatio: 1 },
];

function trip(overrides: Partial<TripRecord> = {}): TripRecord {
  return {
    id: TRIP_ID,
    userId: 'user-1',
    deviceId: 'device-1',
    modelId: 1,
    startedAt: new Date(NOW.getTime() - 600_000),
    endedAt: null,
    framesAnalyzed: 0,
    distanceM: 0,
    ...overrides,
  } as TripRecord;
}

function seen(n: number, overrides: Partial<DetectionInput> = {}): DetectionInput {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    latitude: 4.60971,
    longitude: -74.08175,
    gpsAccuracyM: 5,
    confidence: 0.8,
    bboxAreaRatio: 0.02,
    detectedAt: new Date(NOW.getTime() - 60_000),
    ...overrides,
  };
}

function setup(options: { trip?: TripRecord | null; existing?: number } = {}) {
  const found = options.trip === undefined ? trip() : options.trip;
  const inserted: NewDetection[][] = [];
  const deps = {
    trips: { findOwned: vi.fn(async () => found) },
    models: {
      findActive: vi.fn(async () => ({ id: 1, name: 'm', version: '1.0.0', minConfidence: 0.4 })),
    },
    severities: { findAll: vi.fn(async () => LEVELS) },
    detections: {
      insertMany: vi.fn(async (_tripId: string, rows: readonly NewDetection[]) => {
        inserted.push([...rows]);
        return rows.length - (options.existing ?? 0);
      }),
    },
    parameters: { getNumber: vi.fn(async (_key: string, fallback: number) => fallback) },
    clock: () => NOW,
  };
  return { service: new DetectionIngestService(deps), deps, inserted };
}

describe('DetectionIngestService', () => {
  it('stores the good detections with the severity the server works out', async () => {
    const { service, inserted } = setup();

    const result = await service.ingest('user-1', TRIP_ID, {
      detections: [
        seen(1, { bboxAreaRatio: 0.005 }),
        seen(2, { bboxAreaRatio: 0.02 }),
        seen(3, { bboxAreaRatio: 0.04 }),
      ],
    });

    expect(result).toEqual({ received: 3, stored: 3, duplicates: 0, rejected: [] });
    expect(inserted[0]!.map((row) => row.severityLevelId)).toEqual([1, 2, 3]);
  });

  it('stores the rounded values, not the raw ones', async () => {
    const { service, inserted } = setup();

    await service.ingest('user-1', TRIP_ID, {
      detections: [seen(1, { latitude: 4.60971234567 })],
    });

    expect(inserted[0]![0]!.latitude).toBe(4.609712);
  });

  it('refuses the bad ones with their reason and stores the rest', async () => {
    const { service, inserted } = setup();

    const result = await service.ingest('user-1', TRIP_ID, {
      detections: [seen(1), seen(2, { confidence: 0.1 }), seen(3, { gpsAccuracyM: 80 })],
    });

    expect(result.stored).toBe(1);
    expect(result.rejected).toEqual([
      { id: seen(2).id, reason: 'low_confidence' },
      { id: seen(3).id, reason: 'gps_not_accurate' },
    ]);
    expect(inserted[0]).toHaveLength(1);
  });

  it('counts the detections it already had as duplicates', async () => {
    const { service } = setup({ existing: 2 });

    const result = await service.ingest('user-1', TRIP_ID, { detections: [seen(1), seen(2)] });

    expect(result).toMatchObject({ received: 2, stored: 0, duplicates: 2 });
  });

  it('uses the accuracy limit of the parameters table', async () => {
    const { service, deps } = setup();
    deps.parameters.getNumber.mockResolvedValue(100);

    const result = await service.ingest('user-1', TRIP_ID, {
      detections: [seen(1, { gpsAccuracyM: 80 })],
    });

    expect(result.stored).toBe(1);
  });

  it('says "not found" when the trip is not of the person', async () => {
    const { service } = setup({ trip: null });

    await expect(
      service.ingest('user-2', TRIP_ID, { detections: [seen(1)] }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'TRIP_NOT_FOUND',
    });
  });

  it('takes late detections for a day after the trip ended, and no longer', async () => {
    const recent = setup({ trip: trip({ endedAt: new Date(NOW.getTime() - 23 * 3_600_000) }) });
    await expect(
      recent.service.ingest('user-1', TRIP_ID, { detections: [seen(1)] }),
    ).resolves.toMatchObject({ stored: 1 });

    const old = setup({ trip: trip({ endedAt: new Date(NOW.getTime() - 25 * 3_600_000) }) });
    await expect(
      old.service.ingest('user-1', TRIP_ID, { detections: [seen(1)] }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'TRIP_CLOSED',
    });
  });

  it('answers 503 when there is no active model', async () => {
    const { service, deps } = setup();
    deps.models.findActive.mockResolvedValue(null as never);

    await expect(
      service.ingest('user-1', TRIP_ID, { detections: [seen(1)] }),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'NO_ACTIVE_MODEL',
    });
  });

  it('does not touch the table when nothing is good', async () => {
    const { service, deps } = setup();

    const result = await service.ingest('user-1', TRIP_ID, {
      detections: [seen(1, { confidence: 0.1 })],
    });

    expect(result).toMatchObject({ stored: 0, duplicates: 0 });
    expect(deps.detections.insertMany).toHaveBeenCalledWith(TRIP_ID, [], NOW);
  });
});

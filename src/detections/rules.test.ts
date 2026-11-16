import { describe, expect, it } from 'vitest';
import type { DetectionInput } from './detection-input.js';
import { judgeDetections, rejectionOf, type AcceptanceLimits } from './rules.js';

const NOW = new Date('2026-11-16T12:00:00Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const LIMITS: AcceptanceLimits = {
  now: NOW,
  clockSkewMs: 2 * MINUTE,
  maxAgeMs: 14 * DAY,
  maxGpsAccuracyM: 20,
  minConfidence: 0.4,
  tripStartedAt: new Date('2026-11-16T11:00:00Z'),
};

function seen(change: Partial<DetectionInput> = {}): DetectionInput {
  return {
    id: '0b6f5a9e-6f5e-4f6e-9d63-1c8f3a2b7d10',
    latitude: 1.2136,
    longitude: -77.2811,
    gpsAccuracyM: 8,
    confidence: 0.7,
    bboxAreaRatio: 0.02,
    detectedAt: new Date('2026-11-16T11:30:00Z'),
    ...change,
  };
}

describe('rejectionOf', () => {
  it('accepts a good detection', () => {
    expect(rejectionOf(seen(), LIMITS)).toBeNull();
  });

  it('forgives a clock a little ahead, but not a lot', () => {
    expect(rejectionOf(seen({ detectedAt: new Date(NOW.getTime() + MINUTE) }), LIMITS)).toBeNull();
    expect(rejectionOf(seen({ detectedAt: new Date(NOW.getTime() + 3 * MINUTE) }), LIMITS)).toBe(
      'in_the_future',
    );
  });

  it('refuses a detection older than the limit and accepts one just inside it', () => {
    const limits = { ...LIMITS, tripStartedAt: new Date(NOW.getTime() - 30 * DAY) };

    expect(
      rejectionOf(seen({ detectedAt: new Date(NOW.getTime() - 14 * DAY) }), limits),
    ).toBeNull();
    expect(rejectionOf(seen({ detectedAt: new Date(NOW.getTime() - 14 * DAY - 1) }), limits)).toBe(
      'too_old',
    );
  });

  it('refuses a detection from before the trip started', () => {
    expect(rejectionOf(seen({ detectedAt: new Date('2026-11-16T10:50:00Z') }), LIMITS)).toBe(
      'before_trip',
    );
    expect(rejectionOf(seen({ detectedAt: new Date('2026-11-16T10:59:00Z') }), LIMITS)).toBeNull();
  });

  it('refuses a GPS that is not accurate enough and accepts the limit itself', () => {
    expect(rejectionOf(seen({ gpsAccuracyM: 20 }), LIMITS)).toBeNull();
    expect(rejectionOf(seen({ gpsAccuracyM: 20.01 }), LIMITS)).toBe('gps_not_accurate');
  });

  it('accepts a detection that does not say its GPS accuracy', () => {
    expect(rejectionOf(seen({ gpsAccuracyM: undefined }), LIMITS)).toBeNull();
  });

  it('refuses a confidence under the threshold of the model and accepts the threshold', () => {
    expect(rejectionOf(seen({ confidence: 0.4 }), LIMITS)).toBeNull();
    expect(rejectionOf(seen({ confidence: 0.39 }), LIMITS)).toBe('low_confidence');
  });

  it('reports the first rule broken, in a fixed order', () => {
    const bad = seen({
      detectedAt: new Date(NOW.getTime() + DAY),
      gpsAccuracyM: 500,
      confidence: 0.1,
    });

    expect(rejectionOf(bad, LIMITS)).toBe('in_the_future');
    expect(rejectionOf({ ...bad, detectedAt: seen().detectedAt }, LIMITS)).toBe('gps_not_accurate');
  });
});

describe('judgeDetections', () => {
  it('splits a batch and keeps the order of each part', () => {
    const a = seen({ id: '00000000-0000-4000-8000-00000000000a' });
    const b = seen({ id: '00000000-0000-4000-8000-00000000000b', confidence: 0.1 });
    const c = seen({ id: '00000000-0000-4000-8000-00000000000c' });
    const d = seen({ id: '00000000-0000-4000-8000-00000000000d', gpsAccuracyM: 99 });

    const { accepted, rejected } = judgeDetections([a, b, c, d], LIMITS);

    expect(accepted).toEqual([a, c]);
    expect(rejected).toEqual([
      { id: b.id, reason: 'low_confidence' },
      { id: d.id, reason: 'gps_not_accurate' },
    ]);
  });

  it('accepts everything in an empty list of problems and nothing in an empty batch', () => {
    expect(judgeDetections([], LIMITS)).toEqual({ accepted: [], rejected: [] });
  });
});

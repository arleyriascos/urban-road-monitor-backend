import { describe, expect, it } from 'vitest';
import { detectionSchema } from './detection-input.js';

const VALID = {
  id: '0b6f5a9e-6f5e-4f6e-9d63-1c8f3a2b7d10',
  latitude: 1.2136,
  longitude: -77.2811,
  gpsAccuracyM: 6.5,
  confidence: 0.82,
  bboxAreaRatio: 0.031,
  detectedAt: '2026-11-16T12:00:00.000Z',
};

describe('detectionSchema', () => {
  it('reads a valid detection and turns the date into a Date', () => {
    const parsed = detectionSchema.parse(VALID);

    expect(parsed.detectedAt).toEqual(new Date('2026-11-16T12:00:00.000Z'));
    expect(parsed).toMatchObject({ latitude: 1.2136, confidence: 0.82, bboxAreaRatio: 0.031 });
  });

  it('does not need the GPS accuracy', () => {
    const withoutAccuracy: Record<string, unknown> = { ...VALID };
    delete withoutAccuracy.gpsAccuracyM;

    expect(detectionSchema.parse(withoutAccuracy).gpsAccuracyM).toBeUndefined();
  });

  it('accepts a date with an offset', () => {
    const parsed = detectionSchema.parse({ ...VALID, detectedAt: '2026-11-16T07:00:00-05:00' });

    expect(parsed.detectedAt.toISOString()).toBe('2026-11-16T12:00:00.000Z');
  });

  it.each([
    ['an id that is not a UUID', { id: '123' }],
    ['a latitude above 90', { latitude: 91 }],
    ['a longitude below -180', { longitude: -181 }],
    ['a latitude that is not finite', { latitude: Number.POSITIVE_INFINITY }],
    ['a negative GPS accuracy', { gpsAccuracyM: -1 }],
    ['a confidence above 1', { confidence: 1.1 }],
    ['a negative confidence', { confidence: -0.1 }],
    ['an area of zero', { bboxAreaRatio: 0 }],
    ['an area above 1', { bboxAreaRatio: 1.5 }],
    ['a date without time zone', { detectedAt: '2026-11-16T12:00:00' }],
    ['a date that is not a date', { detectedAt: 'yesterday' }],
    ['a severity sent by the phone', { severity: 'grave' }],
  ])('refuses %s', (_name, change) => {
    expect(detectionSchema.safeParse({ ...VALID, ...change }).success).toBe(false);
  });

  it('refuses a number sent as text', () => {
    expect(detectionSchema.safeParse({ ...VALID, latitude: '1.2' }).success).toBe(false);
  });
});

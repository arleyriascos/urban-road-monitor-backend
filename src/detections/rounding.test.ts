import { describe, expect, it } from 'vitest';
import type { DetectionInput } from './detection-input.js';
import { roundDetection } from './rounding.js';

const BASE: DetectionInput = {
  id: '0b6f5a9e-6f5e-4f6e-9d63-1c8f3a2b7d10',
  latitude: 1.21364999,
  longitude: -77.28115551,
  gpsAccuracyM: 6.4567,
  confidence: 0.81234567,
  bboxAreaRatio: 0.03106,
  detectedAt: new Date('2026-11-16T12:00:00Z'),
};

describe('roundDetection', () => {
  it('rounds every number to the precision of its column', () => {
    expect(roundDetection(BASE)).toMatchObject({
      latitude: 1.21365,
      longitude: -77.281156,
      gpsAccuracyM: 6.46,
      confidence: 0.8123,
      bboxAreaRatio: 0.0311,
    });
  });

  it('keeps the id and the date as they are', () => {
    const rounded = roundDetection(BASE);

    expect(rounded.id).toBe(BASE.id);
    expect(rounded.detectedAt).toBe(BASE.detectedAt);
  });

  it('does not invent a GPS accuracy', () => {
    const rest: Partial<DetectionInput> = { ...BASE };
    delete rest.gpsAccuracyM;

    expect('gpsAccuracyM' in roundDetection(rest as DetectionInput)).toBe(false);
  });

  it('never returns an area of zero', () => {
    expect(roundDetection({ ...BASE, bboxAreaRatio: 0.00001 }).bboxAreaRatio).toBe(0.0001);
  });

  it('turns -0 into 0', () => {
    expect(Object.is(roundDetection({ ...BASE, longitude: -0.0000001 }).longitude, 0)).toBe(true);
  });

  it('does not change the detection it receives', () => {
    const copy = { ...BASE };
    roundDetection(BASE);

    expect(BASE).toEqual(copy);
  });
});

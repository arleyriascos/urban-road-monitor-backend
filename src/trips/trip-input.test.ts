import { describe, expect, it } from 'vitest';
import { endTripSchema, startTripSchema } from './trip-input.js';

const VALID = {
  device: { platform: 'android', browser: 'Chrome 142', label: 'Mi Android' },
  modelVersion: '1.0.0',
  startedAt: '2026-11-16T12:00:00Z',
};

describe('startTripSchema', () => {
  it('reads a start request', () => {
    const parsed = startTripSchema.parse(VALID);

    expect(parsed.device).toEqual({
      platform: 'android',
      browser: 'Chrome 142',
      label: 'Mi Android',
    });
    expect(parsed.startedAt).toEqual(new Date('2026-11-16T12:00:00Z'));
  });

  it('only needs the platform and the model version', () => {
    const parsed = startTripSchema.parse({ device: { platform: 'ios' }, modelVersion: '1.0.0' });

    expect(parsed.device).toEqual({ platform: 'ios' });
    expect(parsed.startedAt).toBeUndefined();
  });

  it('trims the texts', () => {
    const parsed = startTripSchema.parse({
      ...VALID,
      device: { platform: 'other', label: '  Tablet  ' },
    });

    expect(parsed.device.label).toBe('Tablet');
  });

  it.each([
    ['an unknown platform', { device: { platform: 'windows-phone' } }],
    ['no device', { device: undefined }],
    ['an empty model version', { modelVersion: '   ' }],
    ['a model version that is too long', { modelVersion: 'x'.repeat(31) }],
    ['a label that is too long', { device: { platform: 'android', label: 'x'.repeat(101) } }],
    ['a start without time zone', { startedAt: '2026-11-16T12:00:00' }],
    ['a field nobody asked for', { userId: 'someone-else' }],
    ['a field inside the device nobody asked for', { device: { platform: 'android', imei: '1' } }],
  ])('refuses %s', (_name, change) => {
    expect(startTripSchema.safeParse({ ...VALID, ...change }).success).toBe(false);
  });
});

describe('endTripSchema', () => {
  it('reads an end request and rounds nothing', () => {
    const parsed = endTripSchema.parse({
      endedAt: '2026-11-16T12:30:00Z',
      framesAnalyzed: 7200,
      distanceM: 4210.55,
    });

    expect(parsed).toEqual({
      endedAt: new Date('2026-11-16T12:30:00Z'),
      framesAnalyzed: 7200,
      distanceM: 4210.55,
    });
  });

  it('does not need the end time', () => {
    expect(endTripSchema.parse({ framesAnalyzed: 0, distanceM: 0 }).endedAt).toBeUndefined();
  });

  it.each([
    ['frames with decimals', { framesAnalyzed: 1.5 }],
    ['negative frames', { framesAnalyzed: -1 }],
    ['too many frames', { framesAnalyzed: 1_000_001 }],
    ['a negative distance', { distanceM: -1 }],
    ['an endless distance', { distanceM: Number.POSITIVE_INFINITY }],
    ['a distance over 1,000 km', { distanceM: 1_000_001 }],
    ['an end without time zone', { endedAt: '2026-11-16T12:30:00' }],
    ['a field nobody asked for', { status: 'done' }],
  ])('refuses %s', (_name, change) => {
    expect(endTripSchema.safeParse({ framesAnalyzed: 10, distanceM: 100, ...change }).success).toBe(
      false,
    );
  });

  it('needs the two counters', () => {
    expect(endTripSchema.safeParse({}).success).toBe(false);
    expect(endTripSchema.safeParse({ framesAnalyzed: 10 }).success).toBe(false);
  });
});

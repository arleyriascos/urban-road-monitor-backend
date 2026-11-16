import { describe, expect, it } from 'vitest';
import { startTripSchema } from './trip-input.js';

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

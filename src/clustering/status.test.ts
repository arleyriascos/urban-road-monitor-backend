import { describe, expect, it } from 'vitest';
import { decideStatus } from './status.js';

const REPAIRED_AT = new Date('2026-11-10T00:00:00Z');
const BEFORE = new Date('2026-11-09T00:00:00Z');
const AFTER = new Date('2026-11-11T00:00:00Z');

describe('decideStatus', () => {
  it('confirms a cluster seen twice and leaves one seen once unconfirmed', () => {
    expect(decideStatus({ confirmed: true, lastDetectedAt: AFTER }, undefined)).toBe('confirmado');
    expect(decideStatus({ confirmed: false, lastDetectedAt: AFTER }, undefined)).toBe(
      'sin confirmar',
    );
  });

  it('lets a pothole move from unconfirmed to confirmed and back', () => {
    const was = (statusName: string) => ({ statusName, repairedAt: null });
    expect(decideStatus({ confirmed: true, lastDetectedAt: AFTER }, was('sin confirmar'))).toBe(
      'confirmado',
    );
    expect(decideStatus({ confirmed: false, lastDetectedAt: AFTER }, was('confirmado'))).toBe(
      'sin confirmar',
    );
  });

  it('keeps a repaired pothole repaired while no detection is newer than the repair', () => {
    const repaired = { statusName: 'reparado', repairedAt: REPAIRED_AT };
    expect(decideStatus({ confirmed: true, lastDetectedAt: BEFORE }, repaired)).toBe('reparado');
    expect(decideStatus({ confirmed: true, lastDetectedAt: REPAIRED_AT }, repaired)).toBe(
      'reparado',
    );
  });

  it('reopens a repaired pothole when it is seen again after the repair', () => {
    const repaired = { statusName: 'reparado', repairedAt: REPAIRED_AT };
    expect(decideStatus({ confirmed: true, lastDetectedAt: AFTER }, repaired)).toBe('confirmado');
    expect(decideStatus({ confirmed: false, lastDetectedAt: AFTER }, repaired)).toBe(
      'sin confirmar',
    );
  });

  it('keeps it repaired when the day of the repair is not known', () => {
    const repaired = { statusName: 'reparado', repairedAt: null };
    expect(decideStatus({ confirmed: true, lastDetectedAt: AFTER }, repaired)).toBe('reparado');
  });
});

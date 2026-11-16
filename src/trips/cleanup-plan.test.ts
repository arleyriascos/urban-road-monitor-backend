import { describe, expect, it } from 'vitest';
import { colombiaTime, formatCleanupPlan, planCleanup, type CleanupTrip } from './cleanup-plan.js';

function trip(id: string, overrides: Partial<CleanupTrip> = {}): CleanupTrip {
  return {
    id,
    startedAt: new Date('2026-11-16T13:30:00Z'),
    endedAt: new Date('2026-11-16T14:00:00Z'),
    detectionCount: 4,
    detectionsInPotholes: 0,
    ...overrides,
  };
}

describe('planCleanup', () => {
  it('deletes the trips whose detections are in no pothole and adds up what goes', () => {
    const plan = planCleanup([trip('a'), trip('b', { detectionCount: 6 })]);

    expect(plan.deletable.map((t) => t.id)).toEqual(['a', 'b']);
    expect(plan.blocked).toEqual([]);
    expect(plan.totals).toEqual({ trips: 2, detections: 10 });
  });

  it('leaves alone a trip with even one detection in a pothole', () => {
    const plan = planCleanup([trip('a'), trip('b', { detectionsInPotholes: 1 })]);

    expect(plan.deletable.map((t) => t.id)).toEqual(['a']);
    expect(plan.blocked.map((t) => t.id)).toEqual(['b']);
    expect(plan.totals).toEqual({ trips: 1, detections: 4 });
  });

  it('plans nothing for nothing', () => {
    expect(planCleanup([])).toEqual({
      deletable: [],
      blocked: [],
      totals: { trips: 0, detections: 0 },
    });
  });
});

describe('colombiaTime', () => {
  it('writes the moment five hours behind UTC', () => {
    expect(colombiaTime(new Date('2026-11-16T13:30:00Z'))).toBe('2026-11-16 08:30');
    expect(colombiaTime(new Date('2026-11-16T03:00:00Z'))).toBe('2026-11-15 22:00');
  });
});

describe('formatCleanupPlan', () => {
  it('lists what goes with its times and detections', () => {
    const text = formatCleanupPlan('ana@example.com', planCleanup([trip('a')]));

    expect(text).toContain('Se borrarían 1 viajes y 4 detecciones de ana@example.com');
    expect(text).toContain('a  2026-11-16 08:30 → 2026-11-16 09:00  4 detecciones');
  });

  it('says a trip was never closed', () => {
    const text = formatCleanupPlan('ana@example.com', planCleanup([trip('a', { endedAt: null })]));

    expect(text).toContain('→ sin cerrar');
  });

  it('says which trips stay and why', () => {
    const text = formatCleanupPlan(
      'ana@example.com',
      planCleanup([trip('a'), trip('b', { detectionsInPotholes: 2 })]),
    );

    expect(text).toContain('No se tocan');
    expect(text).toContain('2 en baches');
  });

  it('says so when there is nothing', () => {
    expect(formatCleanupPlan('ana@example.com', planCleanup([]))).toBe(
      'La cuenta ana@example.com no tiene viajes que coincidan.',
    );
  });
});

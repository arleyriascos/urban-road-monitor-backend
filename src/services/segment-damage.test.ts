import { describe, expect, it } from 'vitest';
import { computeSegmentDamage, routeCost, type PotholeDamageInput } from './segment-damage.js';

const LEVE = 1;
const MODERADO = 2;
const GRAVE = 3;

const pothole = (
  severityId: number,
  severityWeight: number,
  confidence: number,
  isRepaired = false,
): PotholeDamageInput => ({ severityId, severityWeight, confidence, isRepaired });

describe('computeSegmentDamage', () => {
  it('has no damage and no severity without potholes', () => {
    expect(computeSegmentDamage([])).toEqual({ damageScore: 0, maxSeverityLevelId: null });
  });

  it('counts a sure severe pothole with its full weight', () => {
    expect(computeSegmentDamage([pothole(GRAVE, 6, 1)])).toEqual({
      damageScore: 6,
      maxSeverityLevelId: GRAVE,
    });
  });

  it('adds severity weight x confidence of every pothole', () => {
    const damage = computeSegmentDamage([pothole(LEVE, 0.5, 0.5), pothole(MODERADO, 2, 0.75)]);
    expect(damage.damageScore).toBeCloseTo(0.25 + 1.5, 10);
  });

  it('reports the worst severity even if its confidence is low', () => {
    const damage = computeSegmentDamage([pothole(LEVE, 0.5, 1), pothole(GRAVE, 6, 0.1)]);
    expect(damage.maxSeverityLevelId).toBe(GRAVE);
    expect(damage.damageScore).toBeCloseTo(0.5 + 0.6, 10);
  });

  it('ignores repaired potholes', () => {
    const damage = computeSegmentDamage([pothole(GRAVE, 6, 1, true), pothole(LEVE, 0.5, 1)]);
    expect(damage).toEqual({ damageScore: 0.5, maxSeverityLevelId: LEVE });
  });

  it('has no damage when every pothole is repaired', () => {
    expect(computeSegmentDamage([pothole(GRAVE, 6, 1, true)])).toEqual({
      damageScore: 0,
      maxSeverityLevelId: null,
    });
  });

  it('rounds the damage to 4 decimals (the precision of the column)', () => {
    expect(computeSegmentDamage([pothole(GRAVE, 6, 0.123456)]).damageScore).toBe(0.7407);
  });
});

describe('routeCost', () => {
  it('equals the length when there is no damage', () => {
    expect(routeCost(120, 0)).toBe(120);
  });

  it('is about seven times the length with one sure severe pothole', () => {
    const { damageScore } = computeSegmentDamage([pothole(GRAVE, 6, 1)]);
    expect(routeCost(100, damageScore)).toBe(700);
  });

  it('is never below the real length', () => {
    for (const damage of [0, 0.01, 1, 12.5]) {
      expect(routeCost(80, damage)).toBeGreaterThanOrEqual(80);
    }
  });
});

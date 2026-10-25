import { describe, expect, it } from 'vitest';
import { buildGrid, GRID_CENTER, testCatalogs } from './__fixtures__/grid.js';
import { confidenceFromDetections, planSeed } from './plan.js';
import type { SeedOptions, SeedSegment } from './types.js';

const grid = buildGrid();
const NOW = new Date('2026-10-25T12:00:00.000Z');
const options: SeedOptions = { count: 60, seed: 2026, now: NOW, center: GRID_CENTER };
const plan = planSeed(grid, testCatalogs, options);

const segmentById = new Map(grid.map((segment) => [segment.id, segment]));
const count = (predicate: (value: (typeof plan.potholes)[number]) => boolean) =>
  plan.potholes.filter(predicate).length;

describe('confidenceFromDetections', () => {
  it('grows with the number of detections', () => {
    expect(confidenceFromDetections(1)).toBe(0.5);
    expect(confidenceFromDetections(2)).toBe(0.75);
    expect(confidenceFromDetections(3)).toBe(0.875);
    expect(confidenceFromDetections(12)).toBeLessThan(1);
  });
});

describe('planSeed distribution', () => {
  it('creates the requested number of potholes', () => {
    expect(plan.potholes).toHaveLength(60);
  });

  it('puts 70% in the corridors, 7 in each of the 6 corridors', () => {
    expect(count((pothole) => pothole.inCorridor)).toBe(42);
    expect(plan.corridors).toHaveLength(6);
    expect(plan.corridors.map((corridor) => corridor.potholes)).toEqual([7, 7, 7, 7, 7, 7]);
  });

  it('spreads the other 30% over streets that are not corridors', () => {
    const corridorRoads = new Set(plan.corridors.map((corridor) => corridor.roadId));
    const others = plan.potholes.filter((pothole) => !pothole.inCorridor);
    expect(others).toHaveLength(18);
    for (const pothole of others) {
      expect(corridorRoads.has(segmentById.get(pothole.segmentId)?.roadId ?? -1)).toBe(false);
    }
  });

  it('uses the three severities', () => {
    const severities = new Set(plan.potholes.map((pothole) => pothole.severityName));
    expect([...severities].sort()).toEqual(['grave', 'leve', 'moderado']);
  });

  it('has more severe potholes in the corridors than in the rest of the city', () => {
    const graveShare = (inCorridor: boolean) => {
      const group = plan.potholes.filter((pothole) => pothole.inCorridor === inCorridor);
      return group.filter((pothole) => pothole.severityName === 'grave').length / group.length;
    };
    expect(graveShare(true)).toBeGreaterThan(graveShare(false));
  });

  it('assigns 15% sin confirmar, 10% reparado and the rest confirmado', () => {
    expect(count((pothole) => pothole.statusName === 'sin confirmar')).toBe(9);
    expect(count((pothole) => pothole.statusName === 'reparado')).toBe(6);
    expect(count((pothole) => pothole.statusName === 'confirmado')).toBe(45);
  });
});

describe('planSeed pothole details', () => {
  it('places every pothole on its segment', () => {
    const epsilon = 0.000002;
    for (const pothole of plan.potholes) {
      const [start, end] = segmentById.get(pothole.segmentId)?.geometry ?? [];
      const [minLat, maxLat] = [Math.min(start[0], end[0]), Math.max(start[0], end[0])];
      const [minLon, maxLon] = [Math.min(start[1], end[1]), Math.max(start[1], end[1])];
      expect(pothole.latitude).toBeGreaterThanOrEqual(minLat - epsilon);
      expect(pothole.latitude).toBeLessThanOrEqual(maxLat + epsilon);
      expect(pothole.longitude).toBeGreaterThanOrEqual(minLon - epsilon);
      expect(pothole.longitude).toBeLessThanOrEqual(maxLon + epsilon);
    }
  });

  it('gives sin confirmar potholes one detection and confidence 0.5', () => {
    for (const pothole of plan.potholes.filter((item) => item.statusName === 'sin confirmar')) {
      expect(pothole.detectionCount).toBe(1);
      expect(pothole.confidence).toBe(0.5);
    }
  });

  it('gives confirmed potholes at least 2 detections and the matching confidence', () => {
    for (const pothole of plan.potholes.filter((item) => item.statusName === 'confirmado')) {
      expect(pothole.detectionCount).toBeGreaterThanOrEqual(2);
      expect(pothole.confidence).toBe(confidenceFromDetections(pothole.detectionCount));
    }
  });

  it('reduces the confidence of repaired potholes with the repair factor', () => {
    for (const pothole of plan.potholes.filter((item) => item.statusName === 'reparado')) {
      const expected =
        Math.round(confidenceFromDetections(pothole.detectionCount) * 0.2 * 1e4) / 1e4;
      expect(pothole.confidence).toBeCloseTo(expected, 4);
    }
  });

  it('dates every pothole in the past, with the last detection after the first', () => {
    for (const pothole of plan.potholes) {
      expect(pothole.lastDetectedAt.getTime()).toBeGreaterThanOrEqual(
        pothole.firstDetectedAt.getTime(),
      );
      expect(pothole.lastDetectedAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
      expect(pothole.firstDetectedAt.getTime()).toBeLessThanOrEqual(NOW.getTime() - 9 * 86_400_000);
    }
  });

  it('dates repaired potholes at least 5 days ago', () => {
    for (const pothole of plan.potholes.filter((item) => item.statusName === 'reparado')) {
      expect(pothole.lastDetectedAt.getTime()).toBeLessThanOrEqual(NOW.getTime() - 5 * 86_400_000);
    }
  });
});

describe('planSeed damage', () => {
  it('computes the damage of every affected segment from its active potholes', () => {
    const weights = new Map(
      testCatalogs.severities.map((severity) => [severity.id, severity.costWeight]),
    );
    const expected = new Map<number, number>();
    for (const pothole of plan.potholes) {
      if (pothole.statusName === 'reparado') continue;
      const weight = weights.get(pothole.severityId) ?? 0;
      expected.set(
        pothole.segmentId,
        (expected.get(pothole.segmentId) ?? 0) + weight * pothole.confidence,
      );
    }

    for (const [segmentId, damage] of plan.segmentDamage) {
      expect(damage.damageScore).toBeCloseTo(expected.get(segmentId) ?? 0, 3);
    }
  });

  it('has an entry for every segment that has a pothole, even if all are repaired', () => {
    const withPotholes = new Set(plan.potholes.map((pothole) => pothole.segmentId));
    expect(new Set(plan.segmentDamage.keys())).toEqual(withPotholes);
  });
});

describe('planSeed determinism and edge cases', () => {
  it('gives the same plan for the same seed', () => {
    expect(planSeed(grid, testCatalogs, options)).toEqual(plan);
  });

  it('gives another plan for another seed', () => {
    const other = planSeed(grid, testCatalogs, { ...options, seed: 7 });
    expect(other.potholes).not.toEqual(plan.potholes);
  });

  it('creates nothing when the count is 0 (used to clear the test potholes)', () => {
    const empty = planSeed(grid, testCatalogs, { ...options, count: 0 });
    expect(empty.potholes).toEqual([]);
    expect(empty.segmentDamage.size).toBe(0);
  });

  it('works with a small number of potholes', () => {
    const small = planSeed(grid, testCatalogs, { ...options, count: 3 });
    expect(small.potholes).toHaveLength(3);
  });

  it('puts every pothole outside corridors when the network has no corridor candidates', () => {
    const accessRoads: SeedSegment[] = grid.map((segment) => ({ ...segment, roadType: 'service' }));
    const noCorridors = planSeed(accessRoads, testCatalogs, options);
    expect(noCorridors.corridors).toEqual([]);
    expect(noCorridors.potholes).toHaveLength(60);
    expect(noCorridors.potholes.every((pothole) => !pothole.inCorridor)).toBe(true);
  });

  it('explains which catalog entry is missing', () => {
    const incomplete = { ...testCatalogs, severities: testCatalogs.severities.slice(0, 2) };
    expect(() => planSeed(grid, incomplete, options)).toThrow('grave');
  });
});

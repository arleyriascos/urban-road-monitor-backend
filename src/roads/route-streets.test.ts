import { describe, expect, it } from 'vitest';
import { RoadIndex } from './road-index.js';
import { groupRouteStreets } from './route-streets.js';
import type { SegmentFacts } from './stretch-summary.js';

const GRAVE = { name: 'grave', weight: 6 };

function street(roadId: number, name: string, count: number, damage: Record<number, number> = {}) {
  return Array.from({ length: count }, (_, i): SegmentFacts => ({
    segmentId: roadId * 100 + i,
    roadId,
    roadName: name,
    segmentIndex: i,
    lengthM: 100,
    visiblePotholes: damage[i] ? 1 : 0,
    confirmedPotholes: damage[i] ? 1 : 0,
    damageScore: damage[i] ?? 0,
    worstSeverity: damage[i] ? GRAVE : null,
  }));
}

function city(): RoadIndex {
  const roads = new RoadIndex();
  roads.sync([
    ...street(1, 'Calle 18', 8, { 3: 6, 4: 3 }),
    ...street(2, 'Carrera 27', 5, { 1: 1 }),
  ]);
  return roads;
}

const steps = (...segmentIds: number[]) =>
  segmentIds.map((segmentId, i) => ({ order: i + 1, segmentId }));

describe('groupRouteStreets', () => {
  it('makes one entry of the steps that stay on a street, with the stretch they cover added up', () => {
    const streets = groupRouteStreets(steps(102, 103, 104, 105), city());
    expect(streets).toHaveLength(1);
    expect(streets[0]).toMatchObject({
      roadId: 1,
      roadName: 'Calle 18',
      fromOrder: 1,
      toOrder: 4,
      steps: 4,
      fromSegmentIndex: 2,
      toSegmentIndex: 5,
      summary: {
        segments: 4,
        lengthM: 400,
        confirmedPotholes: 2,
        damageScore: 9,
        worstSeverity: GRAVE,
      },
    });
  });

  it('starts a new entry at each turn, keeping the order of the route', () => {
    const streets = groupRouteStreets(steps(100, 101, 201, 202, 105), city());
    expect(streets.map((s) => [s.roadName, s.fromOrder, s.toOrder, s.steps])).toEqual([
      ['Calle 18', 1, 2, 2],
      ['Carrera 27', 3, 4, 2],
      ['Calle 18', 5, 5, 1],
    ]);
    expect(streets[1]?.summary).toMatchObject({
      segments: 2,
      confirmedPotholes: 1,
      damageScore: 1,
    });
  });

  it('follows a street against its numbering as well', () => {
    const streets = groupRouteStreets(steps(105, 104, 103), city());
    expect(streets[0]).toMatchObject({ fromSegmentIndex: 3, toSegmentIndex: 5, steps: 3 });
    expect(streets[0]?.summary).toMatchObject({ segments: 3, damageScore: 9 });
  });

  it('leaves out a segment the index does not know, and splits the entry there', () => {
    const streets = groupRouteStreets(steps(100, 9999, 101), city());
    expect(streets.map((s) => [s.fromOrder, s.toOrder])).toEqual([
      [1, 1],
      [3, 3],
    ]);
  });

  it('answers nothing for a route with no steps', () => {
    expect(groupRouteStreets([], city())).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { RoadIndex } from './road-index.js';
import type { SegmentFacts } from './stretch-summary.js';

const GRAVE = { name: 'grave', weight: 6 };
const MODERADO = { name: 'moderado', weight: 2 };

/** A street of `count` segments of 100 m; `change` changes the ones named by their index. */
function street(
  roadId: number,
  name: string | null,
  count: number,
  change: Record<number, Partial<SegmentFacts>> = {},
  firstIndex = 0,
): SegmentFacts[] {
  return Array.from({ length: count }, (_, i) => ({
    segmentId: roadId * 1000 + i,
    roadId,
    roadName: name,
    segmentIndex: firstIndex + i,
    lengthM: 100,
    visiblePotholes: 0,
    confirmedPotholes: 0,
    damageScore: 0,
    worstSeverity: null,
    ...change[firstIndex + i],
  }));
}

function index(...streets: SegmentFacts[][]): RoadIndex {
  const result = new RoadIndex();
  result.sync(streets.flat());
  return result;
}

const DAMAGED = {
  2: { visiblePotholes: 2, confirmedPotholes: 1, damageScore: 3, worstSeverity: MODERADO },
  5: { visiblePotholes: 1, confirmedPotholes: 1, damageScore: 6, worstSeverity: GRAVE },
};

describe('RoadIndex', () => {
  it('adds up a whole street', () => {
    const roads = index(street(1, 'Calle 1', 8, DAMAGED));
    expect(roads.road(1)).toEqual({
      roadId: 1,
      roadName: 'Calle 1',
      fromSegmentIndex: 0,
      toSegmentIndex: 7,
      summary: {
        segments: 8,
        lengthM: 800,
        visiblePotholes: 3,
        confirmedPotholes: 2,
        damageScore: 9,
        worstSeverity: GRAVE,
      },
    });
  });

  it('adds up the segments between two indexes, both included', () => {
    const roads = index(street(1, 'Calle 1', 8, DAMAGED));
    const part = roads.stretch(1, 2, 4);
    expect(part?.fromSegmentIndex).toBe(2);
    expect(part?.toSegmentIndex).toBe(4);
    expect(part?.summary).toMatchObject({ segments: 3, damageScore: 3, worstSeverity: MODERADO });
    expect(roads.stretch(1, 5, 5)?.summary).toMatchObject({ segments: 1, damageScore: 6 });
  });

  it('uses the index of each segment, even when the indexes skip numbers', () => {
    const roads = index(street(1, 'Calle 1', 4, { 12: { damageScore: 9 } }, 10));
    expect(roads.stretch(1, 11, 12)?.summary).toMatchObject({ segments: 2, damageScore: 9 });
    expect(roads.stretch(1, 0, 10)?.summary.segments).toBe(1);
  });

  it('gives an empty stretch, not an error, for a range with no segment', () => {
    const roads = index(street(1, 'Calle 1', 3));
    for (const [from, to] of [
      [5, 9],
      [-5, -1],
      [2, 1],
    ] as const) {
      const part = roads.stretch(1, from, to);
      expect(part?.summary.segments).toBe(0);
      expect(part?.fromSegmentIndex).toBeNull();
      expect(part?.toSegmentIndex).toBeNull();
    }
  });

  it('takes the segments around one, and stops at the ends of the street', () => {
    const roads = index(street(1, 'Calle 1', 8, DAMAGED));
    const middle = roads.around(1004, 2);
    expect([middle?.fromSegmentIndex, middle?.toSegmentIndex]).toEqual([2, 6]);
    expect(middle?.summary).toMatchObject({ segments: 5, confirmedPotholes: 2 });

    const start = roads.around(1000, 2);
    expect([start?.fromSegmentIndex, start?.toSegmentIndex]).toEqual([0, 2]);
    const end = roads.around(1007, 3);
    expect([end?.fromSegmentIndex, end?.toSegmentIndex]).toEqual([4, 7]);
    expect(roads.around(1004, 0)?.summary.segments).toBe(1);
  });

  it('knows the street and the place of a segment', () => {
    const roads = index(street(1, 'Calle 1', 3), street(2, null, 2));
    expect(roads.roadIdOfSegment(1002)).toBe(1);
    expect(roads.roadIdOfSegment(2001)).toBe(2);
    expect(roads.positionOf(1002)).toBe(2);
    expect(roads.road(2)?.roadName).toBeNull();
    expect(roads.roadCount).toBe(2);
  });

  it('knows the segment_index of a segment', () => {
    const roads = index(street(1, 'Calle 1', 3, {}, 10));
    expect(roads.segmentIndexOf(1002)).toBe(12);
    expect(roads.segmentIndexOf(555)).toBeUndefined();
  });

  it('says nothing about a street or a segment it does not know', () => {
    const roads = index(street(1, 'Calle 1', 3));
    expect(roads.road(9)).toBeUndefined();
    expect(roads.stretch(9, 0, 1)).toBeUndefined();
    expect(roads.around(555, 2)).toBeUndefined();
    expect(roads.positionOf(555)).toBeUndefined();
    expect(roads.roadIdOfSegment(555)).toBeUndefined();
  });

  it('keeps the streets apart', () => {
    const roads = index(street(1, 'A', 3, { 1: { damageScore: 4 } }), street(2, 'B', 3));
    expect(roads.road(1)?.summary.damageScore).toBe(4);
    expect(roads.road(2)?.summary.damageScore).toBe(0);
  });

  it('puts the segments in order even when they arrive shuffled', () => {
    const shuffled = street(1, 'Calle 1', 6, DAMAGED).reverse();
    const roads = new RoadIndex();
    roads.sync(shuffled);
    expect(roads.stretch(1, 2, 5)?.summary).toMatchObject({ segments: 4, damageScore: 9 });
  });

  describe('sync', () => {
    it('builds every street the first time', () => {
      const roads = new RoadIndex();
      expect(roads.sync([...street(1, 'A', 3), ...street(2, 'B', 2)])).toEqual({
        rebuilt: 2,
        updated: 0,
        removed: 0,
      });
    });

    it('only changes the segments that differ when the street has the same segments', () => {
      const roads = index(street(1, 'A', 6, DAMAGED), street(2, 'B', 3));
      const result = roads.sync([
        ...street(1, 'A', 6, { ...DAMAGED, 5: { ...DAMAGED[5], damageScore: 1 } }),
        ...street(2, 'B', 3),
      ]);
      expect(result).toEqual({ rebuilt: 0, updated: 1, removed: 0 });
      expect(roads.road(1)?.summary.damageScore).toBe(4);
    });

    it('does nothing when nothing changed', () => {
      const roads = index(street(1, 'A', 6, DAMAGED));
      expect(roads.sync(street(1, 'A', 6, DAMAGED))).toEqual({
        rebuilt: 0,
        updated: 0,
        removed: 0,
      });
    });

    it('builds a street again when it gains, loses or renumbers segments', () => {
      const roads = index(street(1, 'A', 4));
      expect(roads.sync(street(1, 'A', 5)).rebuilt).toBe(1);
      expect(roads.road(1)?.summary.segments).toBe(5);
      expect(roads.sync(street(1, 'A', 3)).rebuilt).toBe(1);
      expect(roads.sync(street(1, 'A', 3, {}, 10)).rebuilt).toBe(1);
      expect(roads.stretch(1, 10, 12)?.summary.segments).toBe(3);
    });

    it('forgets the streets and the segments that are gone', () => {
      const roads = index(street(1, 'A', 3), street(2, 'B', 3));
      expect(roads.sync(street(1, 'A', 3)).removed).toBe(1);
      expect(roads.road(2)).toBeUndefined();
      expect(roads.roadIdOfSegment(2001)).toBeUndefined();
      expect(roads.roadCount).toBe(1);
    });

    it('takes a new name of the street', () => {
      const roads = index(street(1, 'Vieja', 3));
      roads.sync(street(1, 'Nueva', 3));
      expect(roads.road(1)?.roadName).toBe('Nueva');
    });
  });
});

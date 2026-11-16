import { SegmentTree } from '../structures/segment-tree.js';
import {
  EMPTY_STRETCH,
  stretchMonoid,
  summaryOfSegment,
  type SegmentFacts,
  type StretchSummary,
} from './stretch-summary.js';

/** A piece of a street and what it adds up to. The indexes are those of road_segments.segment_index. */
export interface RoadStretch {
  roadId: number;
  roadName: string | null;
  /** The first and the last segment that were added up; null when the stretch has none. */
  fromSegmentIndex: number | null;
  toSegmentIndex: number | null;
  summary: StretchSummary;
}

export interface SyncResult {
  /** Streets whose tree was built again because their segments changed. */
  rebuilt: number;
  /** Segments whose value was changed inside a tree that kept its shape. */
  updated: number;
  removed: number;
}

interface RoadEntry {
  roadId: number;
  name: string | null;
  /** The segments of the street in order, and the facts each tree position was made from. */
  facts: SegmentFacts[];
  tree: SegmentTree<StretchSummary>;
}

/**
 * The streets of the city, each one a segment tree over its segments in order. A question like
 * "how many potholes and how much damage between the 3rd and the 9th segment of this street?"
 * is answered by one query on the tree, in O(log n), whatever the length of the street.
 *
 * The index lives in memory. When something changes (a consolidation, an import) `sync` reads
 * the new facts and, for each street, only changes the positions that differ if its segments
 * are the same, and builds its tree again if they are not.
 */
export class RoadIndex {
  private roads = new Map<number, RoadEntry>();
  private roadOfSegment = new Map<number, number>();

  /** Replaces what the index knows with `facts` (segments of any streets, in any order). */
  sync(facts: readonly SegmentFacts[]): SyncResult {
    const byRoad = new Map<number, SegmentFacts[]>();
    for (const item of facts) {
      const list = byRoad.get(item.roadId);
      if (list) list.push(item);
      else byRoad.set(item.roadId, [item]);
    }

    const result: SyncResult = { rebuilt: 0, updated: 0, removed: 0 };
    const next = new Map<number, RoadEntry>();
    for (const [roadId, list] of byRoad) {
      list.sort((a, b) => a.segmentIndex - b.segmentIndex);
      const old = this.roads.get(roadId);
      if (old && sameSegments(old.facts, list)) {
        list.forEach((item, position) => {
          if (!sameFacts(old.facts[position] as SegmentFacts, item)) {
            old.tree.update(position, summaryOfSegment(item));
            result.updated += 1;
          }
        });
        next.set(roadId, { ...old, name: list[0]?.roadName ?? null, facts: list });
      } else {
        next.set(roadId, {
          roadId,
          name: list[0]?.roadName ?? null,
          facts: list,
          tree: new SegmentTree(list.map(summaryOfSegment), stretchMonoid),
        });
        result.rebuilt += 1;
      }
    }
    result.removed = [...this.roads.keys()].filter((id) => !next.has(id)).length;

    this.roads = next;
    this.roadOfSegment = new Map(
      [...next.values()].flatMap((road) =>
        road.facts.map((item) => [item.segmentId, road.roadId] as const),
      ),
    );
    return result;
  }

  get roadCount(): number {
    return this.roads.size;
  }

  /** The street a segment belongs to, if the index knows the segment. */
  roadIdOfSegment(segmentId: number): number | undefined {
    return this.roadOfSegment.get(segmentId);
  }

  /** The whole street. */
  road(roadId: number): RoadStretch | undefined {
    const road = this.roads.get(roadId);
    if (!road) return undefined;
    return this.stretchAt(road, 0, road.facts.length);
  }

  /**
   * The segments of a street whose segment_index is between `fromIndex` and `toIndex`, both
   * included. A range with no segment gives an empty stretch, not an error.
   */
  stretch(roadId: number, fromIndex: number, toIndex: number): RoadStretch | undefined {
    const road = this.roads.get(roadId);
    if (!road) return undefined;
    const from = firstPositionAtLeast(road.facts, fromIndex);
    const to = firstPositionAtLeast(road.facts, toIndex + 1);
    return this.stretchAt(road, from, Math.max(from, to));
  }

  /** `radius` segments before and after a segment, and the segment itself: the stretch around it. */
  around(segmentId: number, radius: number): RoadStretch | undefined {
    const roadId = this.roadOfSegment.get(segmentId);
    const road = roadId === undefined ? undefined : this.roads.get(roadId);
    if (!road) return undefined;
    const position = road.facts.findIndex((item) => item.segmentId === segmentId);
    const from = Math.max(0, position - radius);
    const to = Math.min(road.facts.length, position + radius + 1);
    return this.stretchAt(road, from, to);
  }

  /** The position of a segment in its street, from 0; undefined if it is not known. */
  positionOf(segmentId: number): number | undefined {
    const roadId = this.roadOfSegment.get(segmentId);
    const road = roadId === undefined ? undefined : this.roads.get(roadId);
    const position = road?.facts.findIndex((item) => item.segmentId === segmentId);
    return position === undefined || position < 0 ? undefined : position;
  }

  private stretchAt(road: RoadEntry, from: number, to: number): RoadStretch {
    const empty = from >= to;
    return {
      roadId: road.roadId,
      roadName: road.name,
      fromSegmentIndex: empty ? null : (road.facts[from] as SegmentFacts).segmentIndex,
      toSegmentIndex: empty ? null : (road.facts[to - 1] as SegmentFacts).segmentIndex,
      summary: empty ? EMPTY_STRETCH : road.tree.query(from, to),
    };
  }
}

/** The first position whose segment_index is at least `index` (binary search; the list is sorted). */
function firstPositionAtLeast(facts: readonly SegmentFacts[], index: number): number {
  let low = 0;
  let high = facts.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((facts[middle] as SegmentFacts).segmentIndex < index) low = middle + 1;
    else high = middle;
  }
  return low;
}

function sameSegments(a: readonly SegmentFacts[], b: readonly SegmentFacts[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (item, position) =>
        item.segmentId === (b[position] as SegmentFacts).segmentId &&
        item.segmentIndex === (b[position] as SegmentFacts).segmentIndex,
    )
  );
}

function sameFacts(a: SegmentFacts, b: SegmentFacts): boolean {
  return (
    a.lengthM === b.lengthM &&
    a.visiblePotholes === b.visiblePotholes &&
    a.confirmedPotholes === b.confirmedPotholes &&
    a.damageScore === b.damageScore &&
    a.worstSeverity?.name === b.worstSeverity?.name &&
    a.worstSeverity?.weight === b.worstSeverity?.weight
  );
}

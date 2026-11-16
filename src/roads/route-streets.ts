import type { RoadIndex } from './road-index.js';
import { roundSummary, type StretchSummary } from './stretch-summary.js';

/** One step of a route, as far as the streets are concerned. */
export interface RouteStepRef {
  order: number;
  segmentId: number;
}

/** A street the route follows without leaving it, and the potholes along that part of it. */
export interface RouteStreet {
  roadId: number;
  roadName: string | null;
  /** The first and the last step of the route that are on this street. */
  fromOrder: number;
  toOrder: number;
  steps: number;
  /** The stretch of the street the steps cover, by segment_index. */
  fromSegmentIndex: number;
  toSegmentIndex: number;
  summary: StretchSummary;
}

/**
 * The streets of a route, in order. Steps in a row that are on the same street make one entry,
 * and the stretch they cover is added up with one query of the street's segment tree. The route
 * may come back to a street later: that is another entry. A step whose segment the index does
 * not know (the network changed after the route was made) is left out and ends the entry it was
 * in, so no entry ever claims a stretch the route did not follow.
 */
export function groupRouteStreets(
  steps: readonly RouteStepRef[],
  index: Pick<RoadIndex, 'roadIdOfSegment' | 'segmentIndexOf' | 'stretch'>,
): RouteStreet[] {
  const streets: RouteStreet[] = [];
  let open: {
    roadId: number;
    fromOrder: number;
    toOrder: number;
    count: number;
    low: number;
    high: number;
  } | null = null;

  const close = () => {
    if (!open) return;
    const stretch = index.stretch(open.roadId, open.low, open.high);
    if (stretch && stretch.fromSegmentIndex !== null && stretch.toSegmentIndex !== null) {
      streets.push({
        roadId: open.roadId,
        roadName: stretch.roadName,
        fromOrder: open.fromOrder,
        toOrder: open.toOrder,
        steps: open.count,
        fromSegmentIndex: stretch.fromSegmentIndex,
        toSegmentIndex: stretch.toSegmentIndex,
        summary: roundSummary(stretch.summary),
      });
    }
    open = null;
  };

  for (const step of steps) {
    const roadId = index.roadIdOfSegment(step.segmentId);
    const segmentIndex = index.segmentIndexOf(step.segmentId);
    if (roadId === undefined || segmentIndex === undefined) {
      close();
      continue;
    }
    if (open && open.roadId === roadId) {
      open.toOrder = step.order;
      open.count += 1;
      open.low = Math.min(open.low, segmentIndex);
      open.high = Math.max(open.high, segmentIndex);
    } else {
      close();
      open = {
        roadId,
        fromOrder: step.order,
        toOrder: step.order,
        count: 1,
        low: segmentIndex,
        high: segmentIndex,
      };
    }
  }
  close();
  return streets;
}

import { roundTo } from '../osm/geo.js';
import type { Monoid } from '../structures/segment-tree.js';

/** What the summary of a street needs to know about one of its segments. */
export interface SegmentFacts {
  segmentId: number;
  roadId: number;
  roadName: string | null;
  /** The place of the segment in its street, from 0. Two segments of a street never share it. */
  segmentIndex: number;
  lengthM: number;
  /** Potholes on the segment that are not repaired (the ones the map draws). */
  visiblePotholes: number;
  /** Potholes on the segment that are confirmed (the only ones that change the damage). */
  confirmedPotholes: number;
  /** road_segments.damage_score. */
  damageScore: number;
  /** The worst severity of the confirmed potholes, or null when there is none. */
  worstSeverity: { name: string; weight: number } | null;
}

/** The worst severity of a stretch: its name and its weight, which orders the severities. */
export interface WorstSeverity {
  name: string;
  weight: number;
}

/** A stretch of a street (one segment, a few, or all of them) added up. */
export interface StretchSummary {
  segments: number;
  lengthM: number;
  visiblePotholes: number;
  confirmedPotholes: number;
  /** The damage of the segments added up. */
  damageScore: number;
  worstSeverity: WorstSeverity | null;
}

export const EMPTY_STRETCH: StretchSummary = {
  segments: 0,
  lengthM: 0,
  visiblePotholes: 0,
  confirmedPotholes: 0,
  damageScore: 0,
  worstSeverity: null,
};

/**
 * How two neighbouring stretches become one: counts and lengths are added, and the worst
 * severity is the one with the bigger weight (the left one when they weigh the same). It is
 * associative, so a segment tree can answer any stretch of a street with it.
 */
export const stretchMonoid: Monoid<StretchSummary> = {
  identity: EMPTY_STRETCH,
  combine: (left, right) => ({
    segments: left.segments + right.segments,
    lengthM: left.lengthM + right.lengthM,
    visiblePotholes: left.visiblePotholes + right.visiblePotholes,
    confirmedPotholes: left.confirmedPotholes + right.confirmedPotholes,
    damageScore: left.damageScore + right.damageScore,
    worstSeverity: worse(left.worstSeverity, right.worstSeverity),
  }),
};

function worse(a: WorstSeverity | null, b: WorstSeverity | null): WorstSeverity | null {
  if (a === null) return b;
  if (b === null) return a;
  return b.weight > a.weight ? b : a;
}

/** One segment as a stretch of its own. */
export function summaryOfSegment(facts: SegmentFacts): StretchSummary {
  return {
    segments: 1,
    lengthM: facts.lengthM,
    visiblePotholes: facts.visiblePotholes,
    confirmedPotholes: facts.confirmedPotholes,
    damageScore: facts.damageScore,
    worstSeverity: facts.worstSeverity,
  };
}

/** The numbers rounded for an answer: sums of decimals carry tiny errors that nobody wants to see. */
export function roundSummary(summary: StretchSummary): StretchSummary {
  return {
    ...summary,
    lengthM: roundTo(summary.lengthM, 2),
    damageScore: roundTo(summary.damageScore, 4),
  };
}

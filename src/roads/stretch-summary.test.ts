import { describe, expect, it } from 'vitest';
import {
  EMPTY_STRETCH,
  roundSummary,
  stretchMonoid,
  summaryOfSegment,
  type SegmentFacts,
  type StretchSummary,
} from './stretch-summary.js';

const GRAVE = { name: 'grave', weight: 6 };
const LEVE = { name: 'leve', weight: 0.5 };

function facts(change: Partial<SegmentFacts> = {}): SegmentFacts {
  return {
    segmentId: 1,
    roadId: 1,
    roadName: 'Calle 1',
    segmentIndex: 0,
    lengthM: 100,
    visiblePotholes: 0,
    confirmedPotholes: 0,
    damageScore: 0,
    worstSeverity: null,
    ...change,
  };
}

describe('summaryOfSegment', () => {
  it('turns the facts of a segment into a stretch of one segment', () => {
    expect(
      summaryOfSegment(
        facts({
          lengthM: 80,
          visiblePotholes: 3,
          confirmedPotholes: 2,
          damageScore: 4.5,
          worstSeverity: GRAVE,
        }),
      ),
    ).toEqual({
      segments: 1,
      lengthM: 80,
      visiblePotholes: 3,
      confirmedPotholes: 2,
      damageScore: 4.5,
      worstSeverity: GRAVE,
    });
  });
});

describe('stretchMonoid', () => {
  const a = summaryOfSegment(
    facts({
      lengthM: 100,
      visiblePotholes: 1,
      confirmedPotholes: 1,
      damageScore: 0.5,
      worstSeverity: LEVE,
    }),
  );
  const b = summaryOfSegment(
    facts({
      lengthM: 50,
      visiblePotholes: 2,
      confirmedPotholes: 0,
      damageScore: 0,
      worstSeverity: null,
    }),
  );
  const c = summaryOfSegment(
    facts({
      lengthM: 70,
      visiblePotholes: 1,
      confirmedPotholes: 1,
      damageScore: 6,
      worstSeverity: GRAVE,
    }),
  );

  it('adds counts, lengths and damage, and keeps the worst severity', () => {
    expect(stretchMonoid.combine(a, c)).toEqual({
      segments: 2,
      lengthM: 170,
      visiblePotholes: 2,
      confirmedPotholes: 2,
      damageScore: 6.5,
      worstSeverity: GRAVE,
    });
  });

  it('changes nothing when it is joined with the empty stretch, on either side', () => {
    expect(stretchMonoid.combine(EMPTY_STRETCH, a)).toEqual(a);
    expect(stretchMonoid.combine(a, EMPTY_STRETCH)).toEqual(a);
  });

  it('is associative', () => {
    const left = stretchMonoid.combine(stretchMonoid.combine(a, b), c);
    const right = stretchMonoid.combine(a, stretchMonoid.combine(b, c));
    expect(left).toEqual(right);
  });

  it('keeps the left severity when two weigh the same', () => {
    const other = summaryOfSegment(facts({ worstSeverity: { name: 'otra', weight: 0.5 } }));
    expect(stretchMonoid.combine(a, other).worstSeverity).toEqual(LEVE);
  });

  it('has no severity when no segment has one', () => {
    expect(stretchMonoid.combine(b, b).worstSeverity).toBeNull();
  });
});

describe('roundSummary', () => {
  it('rounds the length to centimeters and the damage to 4 decimals', () => {
    const rounded: StretchSummary = roundSummary({
      ...EMPTY_STRETCH,
      lengthM: 0.1 + 0.2 + 100,
      damageScore: 0.1 + 0.2,
    });
    expect(rounded.lengthM).toBe(100.3);
    expect(rounded.damageScore).toBe(0.3);
  });
});

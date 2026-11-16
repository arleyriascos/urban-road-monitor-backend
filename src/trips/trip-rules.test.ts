import { describe, expect, it } from 'vitest';
import {
  acceptsDetections,
  chooseEndedAt,
  chooseStartedAt,
  CLOCK_SKEW_MS,
  LATE_DETECTIONS_GRACE_MS,
} from './trip-rules.js';

const NOW = new Date('2026-11-16T12:00:00Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);
const HOUR = 3_600_000;

describe('chooseStartedAt', () => {
  it('uses now when the phone says nothing', () => {
    expect(chooseStartedAt(undefined, NOW)).toBe(NOW);
  });

  it('believes a start from a few minutes ago', () => {
    const claimed = at(-10 * 60_000);

    expect(chooseStartedAt(claimed, NOW)).toBe(claimed);
  });

  it('forgives a clock a little ahead and then stops believing it', () => {
    expect(chooseStartedAt(at(CLOCK_SKEW_MS), NOW).getTime()).toBe(at(CLOCK_SKEW_MS).getTime());
    expect(chooseStartedAt(at(CLOCK_SKEW_MS + 1), NOW)).toBe(NOW);
  });

  it('does not believe a start from three days ago', () => {
    expect(chooseStartedAt(at(-72 * HOUR), NOW)).toBe(NOW);
  });
});

describe('chooseEndedAt', () => {
  const started = at(-HOUR);

  it('uses now when the phone says nothing', () => {
    expect(chooseEndedAt(undefined, started, NOW)).toEqual(NOW);
  });

  it('believes an end between the start and now', () => {
    const claimed = at(-10 * 60_000);

    expect(chooseEndedAt(claimed, started, NOW)).toBe(claimed);
  });

  it('does not believe an end before the start', () => {
    expect(chooseEndedAt(at(-2 * HOUR), started, NOW)).toEqual(NOW);
  });

  it('does not believe an end in the future', () => {
    expect(chooseEndedAt(at(HOUR), started, NOW)).toEqual(NOW);
  });

  it('never ends a trip before it started, even if the start is a bit ahead of now', () => {
    const early = at(CLOCK_SKEW_MS);

    expect(chooseEndedAt(undefined, early, NOW).getTime()).toBe(early.getTime());
  });
});

describe('acceptsDetections', () => {
  it('accepts while the trip is open', () => {
    expect(acceptsDetections({ endedAt: null }, NOW)).toBe(true);
  });

  it('accepts for a day after the trip ended, and not after', () => {
    const ended = new Date(NOW.getTime() - LATE_DETECTIONS_GRACE_MS);

    expect(acceptsDetections({ endedAt: ended }, NOW)).toBe(true);
    expect(acceptsDetections({ endedAt: new Date(ended.getTime() - 1) }, NOW)).toBe(false);
  });
});

/**
 * Random changes to the streets and random questions, compared with adding the segments up one
 * by one. It checks that `sync` leaves the same answers as building the index from scratch. The
 * seeds are fixed, so every run does the same.
 */
import { describe, expect, it } from 'vitest';
import { RoadIndex } from './road-index.js';
import {
  EMPTY_STRETCH,
  stretchMonoid,
  summaryOfSegment,
  type SegmentFacts,
} from './stretch-summary.js';

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const SEVERITIES = [
  null,
  { name: 'leve', weight: 0.5 },
  { name: 'moderado', weight: 2 },
  { name: 'grave', weight: 6 },
];

function makeCity(random: () => number): SegmentFacts[] {
  const facts: SegmentFacts[] = [];
  const roads = 1 + Math.floor(random() * 4);
  for (let roadId = 1; roadId <= roads; roadId++) {
    const count = Math.floor(random() * 30);
    let segmentIndex = Math.floor(random() * 3);
    for (let i = 0; i < count; i++) {
      segmentIndex += 1 + (random() < 0.15 ? 1 : 0); // sometimes an index is skipped
      const worst = SEVERITIES[Math.floor(random() * SEVERITIES.length)] ?? null;
      facts.push({
        segmentId: roadId * 1000 + segmentIndex,
        roadId,
        roadName: `Calle ${roadId}`,
        segmentIndex,
        lengthM: 20 + Math.floor(random() * 150),
        visiblePotholes: Math.floor(random() * 4),
        confirmedPotholes: Math.floor(random() * 3),
        damageScore: worst ? Math.floor(random() * 80) / 4 : 0,
        worstSeverity: worst,
      });
    }
  }
  return facts;
}

/** The plain way: pick the segments of the street in the range and join them one by one. */
function naive(facts: SegmentFacts[], roadId: number, from: number, to: number) {
  return facts
    .filter(
      (item) => item.roadId === roadId && item.segmentIndex >= from && item.segmentIndex <= to,
    )
    .sort((a, b) => a.segmentIndex - b.segmentIndex)
    .map(summaryOfSegment)
    .reduce(stretchMonoid.combine, EMPTY_STRETCH);
}

describe('RoadIndex (random runs)', () => {
  for (let seed = 1; seed <= 40; seed++) {
    it(`agrees with adding the segments one by one, also after changes (seed ${seed})`, () => {
      const random = seededRandom(seed);
      let city = makeCity(random);
      const roads = new RoadIndex();
      roads.sync(city);

      for (let round = 0; round < 4; round++) {
        for (let question = 0; question < 40; question++) {
          const roadId = 1 + Math.floor(random() * 4);
          const from = Math.floor(random() * 40) - 3;
          const to = from + Math.floor(random() * 30);
          const stretch = roads.stretch(roadId, from, to);
          if (!city.some((item) => item.roadId === roadId)) {
            expect(stretch).toBeUndefined();
            continue;
          }
          expect(stretch?.summary).toEqual(naive(city, roadId, from, to));
        }
        // Some segments change (the usual case), now and then the street changes shape.
        city = city.map((item) =>
          random() < 0.2
            ? {
                ...item,
                damageScore: Math.floor(random() * 40),
                visiblePotholes: Math.floor(random() * 5),
              }
            : item,
        );
        if (random() < 0.3) city = city.filter(() => random() < 0.9);
        roads.sync(city);

        const fresh = new RoadIndex();
        fresh.sync(city);
        for (const roadId of new Set(city.map((item) => item.roadId))) {
          expect(roads.road(roadId)).toEqual(fresh.road(roadId));
        }
      }
    });
  }
});

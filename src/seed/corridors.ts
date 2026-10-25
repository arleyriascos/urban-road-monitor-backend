import { haversineDistance } from '../osm/geo.js';
import type { LatLon } from '../osm/types.js';
import { midpoint } from './polyline.js';
import type { SeedSegment } from './types.js';

/** Plaza de Nariño, the main square of Pasto. */
export const PASTO_CENTER: LatLon = [1.2136, -77.2811];

export const CORRIDOR_COUNT = 6;

/** Streets farther than this from the center are not corridors. */
const MAX_DISTANCE_FROM_CENTER_M = 4_000;
const MIN_CORRIDOR_LENGTH_M = 300;
/** A street is an alternative if a segment of it is this close to the corridor. */
const ALTERNATIVE_RADIUS_M = 200;
const MIN_ALTERNATIVES = 3;

const ARTERIAL_TYPES = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
const STREET_TYPES = new Set(['residential', 'unclassified']);

export interface Corridor {
  roadId: number;
  name: string;
  segments: SeedSegment[];
  alternatives: number;
}

interface Candidate {
  roadId: number;
  name: string;
  segments: SeedSegment[];
  tier: number;
  distanceM: number;
  alternatives: number;
}

function centroid(midpoints: readonly LatLon[]): LatLon {
  const sum = midpoints.reduce<LatLon>((acc, [lat, lon]) => [acc[0] + lat, acc[1] + lon], [0, 0]);
  return [sum[0] / midpoints.length, sum[1] / midpoints.length];
}

/**
 * Chooses the streets where most test potholes will be concentrated: named streets of at
 * least 300 m, close to the center, preferring main roads and requiring several other streets
 * nearby so that a route can go around them. The result does not depend on chance.
 */
export function selectCorridors(
  segments: readonly SeedSegment[],
  center: LatLon | null,
  count: number = CORRIDOR_COUNT,
): Corridor[] {
  if (segments.length === 0) return [];

  const midpoints = segments.map((segment) => midpoint(segment.geometry));
  const nearCenter =
    center !== null &&
    midpoints.some((point) => haversineDistance(center, point) <= MAX_DISTANCE_FROM_CENTER_M);
  const origin = nearCenter && center ? center : centroid(midpoints);

  const byRoad = new Map<number, { segment: SeedSegment; midpoint: LatLon }[]>();
  segments.forEach((segment, index) => {
    const list = byRoad.get(segment.roadId) ?? [];
    list.push({ segment, midpoint: midpoints[index] });
    byRoad.set(segment.roadId, list);
  });

  const candidates: Candidate[] = [];
  for (const [roadId, items] of byRoad) {
    const first = items[0].segment;
    const tier = ARTERIAL_TYPES.has(first.roadType) ? 0 : STREET_TYPES.has(first.roadType) ? 1 : -1;
    const totalLength = items.reduce((sum, item) => sum + item.segment.lengthM, 0);
    const distanceM = Math.min(...items.map((item) => haversineDistance(origin, item.midpoint)));

    if (tier < 0 || !first.roadName) continue;
    if (totalLength < MIN_CORRIDOR_LENGTH_M || distanceM > MAX_DISTANCE_FROM_CENTER_M) continue;

    candidates.push({
      roadId,
      name: first.roadName,
      segments: items.map((item) => item.segment),
      tier,
      distanceM,
      alternatives: 0,
    });
  }

  candidates.sort((a, b) => a.tier - b.tier || a.distanceM - b.distanceM || a.roadId - b.roadId);

  const middleOf = (candidate: Candidate): LatLon => {
    const middle = candidate.segments[Math.floor(candidate.segments.length / 2)];
    return midpoint(middle.geometry);
  };

  for (const candidate of candidates) {
    const middle = middleOf(candidate);
    const nearbyRoads = new Set<number>();
    segments.forEach((segment, index) => {
      if (
        segment.roadId !== candidate.roadId &&
        haversineDistance(middle, midpoints[index]) <= ALTERNATIVE_RADIUS_M
      ) {
        nearbyRoads.add(segment.roadId);
      }
    });
    candidate.alternatives = nearbyRoads.size;
  }

  // First the candidates with enough alternatives, then relax the requirement.
  const chosen: Candidate[] = [];
  const names = new Set<string>();
  for (const minimum of [MIN_ALTERNATIVES, 1, 0]) {
    for (const candidate of candidates) {
      if (chosen.length >= count) break;
      if (chosen.includes(candidate) || names.has(candidate.name)) continue;
      if (candidate.alternatives < minimum) continue;
      chosen.push(candidate);
      names.add(candidate.name);
    }
  }

  return chosen.map((candidate) => ({
    roadId: candidate.roadId,
    name: candidate.name,
    segments: candidate.segments,
    alternatives: candidate.alternatives,
  }));
}

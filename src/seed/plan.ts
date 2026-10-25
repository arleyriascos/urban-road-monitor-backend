import { roundTo } from '../osm/geo.js';
import { computeSegmentDamage, type SegmentDamage } from '../services/segment-damage.js';
import { selectCorridors } from './corridors.js';
import { pointAlong } from './polyline.js';
import { createRandom, randomInt, shuffle, weightedPick, type Random } from './prng.js';
import type {
  PlannedCorridor,
  PlannedPothole,
  SeedCatalogs,
  SeedOptions,
  SeedPlan,
  SeedSegment,
} from './types.js';

/** Share of the potholes concentrated in the corridors; the rest is spread over the city. */
export const CORRIDOR_SHARE = 0.7;
const UNCONFIRMED_SHARE = 0.15;
const REPAIRED_SHARE = 0.1;
const MIN_SEGMENT_LENGTH_M = 30;
const MINUTES_PER_DAY = 24 * 60;

/** Corridors have more severe potholes than the rest of the city. */
const SEVERITY_MIX_CORRIDOR = [
  { value: 'leve', weight: 0.25 },
  { value: 'moderado', weight: 0.4 },
  { value: 'grave', weight: 0.35 },
];
const SEVERITY_MIX_ELSEWHERE = [
  { value: 'leve', weight: 0.5 },
  { value: 'moderado', weight: 0.35 },
  { value: 'grave', weight: 0.15 },
];

/** Confidence grows with the number of detections: 1 -> 0.5, 2 -> 0.75, 3 -> 0.875... */
export function confidenceFromDetections(detections: number): number {
  return roundTo(1 - 0.5 ** detections, 4);
}

interface Placement {
  segment: SeedSegment;
  inCorridor: boolean;
}

function lookup<T extends { name: string }>(items: readonly T[], name: string): T {
  const found = items.find((item) => item.name === name);
  if (!found) throw new Error(`Falta "${name}" en el catálogo de la base de datos`);
  return found;
}

/** Spreads `total` potholes over `groups` as evenly as possible. */
function share(total: number, groups: number, index: number): number {
  return Math.floor(total / groups) + (index < total % groups ? 1 : 0);
}

/** Picks `amount` segments, going around the shuffled list again if it is too short. */
function takeSegments(random: Random, segments: readonly SeedSegment[], amount: number) {
  const shuffled = shuffle(random, segments);
  return Array.from({ length: amount }, (_unused, i) => shuffled[i % shuffled.length]);
}

function planDates(random: Random, now: Date, repaired: boolean) {
  const firstMinutesAgo = randomInt(random, 10 * MINUTES_PER_DAY, 60 * MINUTES_PER_DAY);
  const lastMinutesAgo = repaired
    ? firstMinutesAgo - randomInt(random, MINUTES_PER_DAY, 5 * MINUTES_PER_DAY)
    : randomInt(random, 0, 9 * MINUTES_PER_DAY);

  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000);
  return { first: at(firstMinutesAgo), last: at(lastMinutesAgo) };
}

/**
 * Decides where, how bad and in which state every test pothole is. Pure and deterministic:
 * the same segments, catalogs and options always give the same plan.
 *  - 70% of the potholes go to 6 corridors near the center, 30% anywhere else.
 *  - 15% are "sin confirmar", 10% "reparado" and the rest "confirmado".
 */
export function planSeed(
  segments: readonly SeedSegment[],
  catalogs: SeedCatalogs,
  options: SeedOptions,
): SeedPlan {
  const random = createRandom(options.seed);
  const corridors = selectCorridors(segments, options.center);
  const corridorTotal = corridors.length === 0 ? 0 : Math.round(options.count * CORRIDOR_SHARE);

  const placements: Placement[] = [];
  const plannedCorridors: PlannedCorridor[] = [];

  corridors.forEach((corridor, index) => {
    const amount = share(corridorTotal, corridors.length, index);
    plannedCorridors.push({
      roadId: corridor.roadId,
      name: corridor.name,
      potholes: amount,
      alternatives: corridor.alternatives,
    });
    for (const segment of takeSegments(random, corridor.segments, amount)) {
      placements.push({ segment, inCorridor: true });
    }
  });

  const corridorRoads = new Set(corridors.map((corridor) => corridor.roadId));
  const elsewhere = segments.filter(
    (segment) => !corridorRoads.has(segment.roadId) && segment.lengthM >= MIN_SEGMENT_LENGTH_M,
  );
  const elsewhereAmount = options.count - corridorTotal;
  if (elsewhereAmount > 0) {
    if (elsewhere.length === 0) throw new Error('No hay tramos suficientes para los baches');
    for (const segment of takeSegments(random, elsewhere, elsewhereAmount)) {
      placements.push({ segment, inCorridor: false });
    }
  }

  // Which potholes are unconfirmed or repaired is decided over the whole list.
  const order = shuffle(
    random,
    placements.map((_placement, index) => index),
  );
  const unconfirmedCount = Math.round(placements.length * UNCONFIRMED_SHARE);
  const repairedCount = Math.round(placements.length * REPAIRED_SHARE);
  const statusOf = new Map<number, string>();
  order.forEach((index, position) => {
    statusOf.set(
      index,
      position < unconfirmedCount
        ? 'sin confirmar'
        : position < unconfirmedCount + repairedCount
          ? 'reparado'
          : 'confirmado',
    );
  });

  const potholes = placements.map((placement, index): PlannedPothole => {
    const severity = lookup(
      catalogs.severities,
      weightedPick(random, placement.inCorridor ? SEVERITY_MIX_CORRIDOR : SEVERITY_MIX_ELSEWHERE),
    );
    const statusName = statusOf.get(index) ?? 'confirmado';
    const status = lookup(catalogs.statuses, statusName);

    const [latitude, longitude] = pointAlong(placement.segment.geometry, 0.2 + 0.6 * random());
    const detectionCount =
      statusName === 'sin confirmar'
        ? 1
        : statusName === 'reparado'
          ? randomInt(random, 2, 8)
          : randomInt(random, 2, 12);
    const confidence =
      statusName === 'reparado'
        ? roundTo(confidenceFromDetections(detectionCount) * catalogs.repairFactor, 4)
        : confidenceFromDetections(detectionCount);
    const dates = planDates(random, options.now, statusName === 'reparado');

    return {
      segmentId: placement.segment.id,
      latitude: roundTo(latitude, 6),
      longitude: roundTo(longitude, 6),
      severityId: severity.id,
      severityName: severity.name,
      statusId: status.id,
      statusName,
      confidence,
      detectionCount,
      firstDetectedAt: dates.first,
      lastDetectedAt: dates.last,
      inCorridor: placement.inCorridor,
    };
  });

  const bySegment = new Map<number, PlannedPothole[]>();
  for (const pothole of potholes) {
    bySegment.set(pothole.segmentId, [...(bySegment.get(pothole.segmentId) ?? []), pothole]);
  }

  const weights = new Map(
    catalogs.severities.map((severity) => [severity.id, severity.costWeight]),
  );
  const segmentDamage = new Map<number, SegmentDamage>();
  for (const [segmentId, list] of bySegment) {
    segmentDamage.set(
      segmentId,
      computeSegmentDamage(
        list.map((pothole) => ({
          severityId: pothole.severityId,
          severityWeight: weights.get(pothole.severityId) ?? 0,
          confidence: pothole.confidence,
          isRepaired: pothole.statusName === 'reparado',
        })),
      ),
    );
  }

  return { potholes, corridors: plannedCorridors, segmentDamage };
}

import { haversineDistance } from '../osm/geo.js';
import type { FoundCluster } from './ai-contract.js';
import { decideStatus, type ExistingPothole, type PotholeStatusName } from './status.js';

/** A pothole the run leaves in the database: an old one kept, or a new one. */
export interface PlannedPothole {
  id: string;
  isNew: boolean;
  cluster: FoundCluster;
  status: PotholeStatusName;
  /** Where the pothole was before the run, so that segment is worked out again too. */
  previousSegmentId: number | null;
}

export interface ReconcilePlan {
  potholes: PlannedPothole[];
  /** Old potholes that no cluster points at any more. */
  removedIds: string[];
  /** Detections that were read and ended up in no cluster. */
  unlinkedDetectionIds: string[];
}

export interface ReconcileInput {
  clusters: readonly FoundCluster[];
  /** The potholes made by earlier runs. Potholes of the seed are never given here. */
  existing: readonly ExistingPothole[];
  /** For each detection that was read: the pothole it belonged to before the run, if any. */
  previousPothole: ReadonlyMap<string, string | null>;
  /** How far a cluster may be from an old pothole to take its place when no detection says so. */
  maxMatchDistanceM: number;
  newId: () => string;
}

interface Candidate {
  cluster: number;
  pothole: number;
  votes: number;
  distanceM: number;
}

/**
 * Decides which pothole each cluster becomes, so a pothole keeps its id from one run to the next
 * (the app, the repair reports and the history point at that id).
 *
 * 1. A cluster takes the old pothole that most of its detections belonged to. When two clusters
 *    want the same pothole, the one with more votes keeps it, then the nearest one.
 * 2. A cluster left without one takes the nearest old pothole that is free and within
 *    `maxMatchDistanceM`.
 * 3. Any other cluster is a new pothole.
 * 4. An old pothole that no cluster took is removed, except a repaired one: its repair is
 *    kept even when the detections that made it have grown too old to be read.
 *
 * Running it again on its own result changes nothing: every pothole keeps its id and no pothole
 * is new or removed.
 */
export function reconcile(input: ReconcileInput): ReconcilePlan {
  const { clusters, existing } = input;
  const indexOfPothole = new Map(existing.map((pothole, index) => [pothole.id, index]));
  const takenBy = new Map<number, number>(); // pothole index -> cluster index
  const matchOf = new Map<number, number>(); // cluster index -> pothole index

  // Step 1: by votes.
  const candidates: Candidate[] = [];
  clusters.forEach((cluster, clusterIndex) => {
    const votes = new Map<number, number>();
    for (const detectionId of cluster.detectionIds) {
      const previous = input.previousPothole.get(detectionId);
      const potholeIndex = previous == null ? undefined : indexOfPothole.get(previous);
      if (potholeIndex !== undefined) {
        votes.set(potholeIndex, (votes.get(potholeIndex) ?? 0) + 1);
      }
    }
    for (const [potholeIndex, count] of votes) {
      candidates.push({
        cluster: clusterIndex,
        pothole: potholeIndex,
        votes: count,
        distanceM: distanceBetween(cluster, existing[potholeIndex]),
      });
    }
  });
  candidates.sort(
    (a, b) =>
      b.votes - a.votes ||
      a.distanceM - b.distanceM ||
      compareIds(existing[a.pothole]?.id, existing[b.pothole]?.id) ||
      a.cluster - b.cluster,
  );
  for (const candidate of candidates) {
    if (!takenBy.has(candidate.pothole) && !matchOf.has(candidate.cluster)) {
      takenBy.set(candidate.pothole, candidate.cluster);
      matchOf.set(candidate.cluster, candidate.pothole);
    }
  }

  // Step 2: by distance, for the clusters that no detection tied to an old pothole.
  const nearby: Candidate[] = [];
  clusters.forEach((cluster, clusterIndex) => {
    if (matchOf.has(clusterIndex)) return;
    existing.forEach((pothole, potholeIndex) => {
      if (takenBy.has(potholeIndex)) return;
      const distanceM = distanceBetween(cluster, pothole);
      if (distanceM <= input.maxMatchDistanceM) {
        nearby.push({ cluster: clusterIndex, pothole: potholeIndex, votes: 0, distanceM });
      }
    });
  });
  nearby.sort(
    (a, b) =>
      a.distanceM - b.distanceM ||
      compareIds(existing[a.pothole]?.id, existing[b.pothole]?.id) ||
      a.cluster - b.cluster,
  );
  for (const candidate of nearby) {
    if (!takenBy.has(candidate.pothole) && !matchOf.has(candidate.cluster)) {
      takenBy.set(candidate.pothole, candidate.cluster);
      matchOf.set(candidate.cluster, candidate.pothole);
    }
  }

  // Steps 3 and 4.
  const potholes = clusters.map((cluster, clusterIndex): PlannedPothole => {
    const potholeIndex = matchOf.get(clusterIndex);
    const old = potholeIndex === undefined ? undefined : existing[potholeIndex];
    return {
      id: old?.id ?? input.newId(),
      isNew: old === undefined,
      cluster,
      status: decideStatus(cluster, old),
      previousSegmentId: old?.segmentId ?? null,
    };
  });

  const removedIds = existing
    .filter((pothole, index) => !takenBy.has(index) && pothole.statusName !== 'reparado')
    .map((pothole) => pothole.id);

  const inCluster = new Set(clusters.flatMap((cluster) => cluster.detectionIds));
  const unlinkedDetectionIds = [...input.previousPothole.keys()].filter((id) => !inCluster.has(id));

  return { potholes, removedIds, unlinkedDetectionIds };
}

function distanceBetween(cluster: FoundCluster, pothole: ExistingPothole | undefined): number {
  if (pothole === undefined) return Number.POSITIVE_INFINITY;
  return haversineDistance(
    [cluster.latitude, cluster.longitude],
    [pothole.latitude, pothole.longitude],
  );
}

function compareIds(a: string | undefined, b: string | undefined): number {
  return (a ?? '') < (b ?? '') ? -1 : (a ?? '') > (b ?? '') ? 1 : 0;
}

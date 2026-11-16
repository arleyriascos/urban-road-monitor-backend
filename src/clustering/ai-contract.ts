import { z } from 'zod';

/**
 * The contract of POST /clusters of the AI service, seen from the backend.
 *
 * The AI service names every detection with a whole number, but the detections of the database
 * have a UUID. So the backend sends the position of each detection in the list as its number,
 * and uses the same positions to find the detections again in the answer. The AI service never
 * sees a UUID, and a number that comes back and does not point at a detection is a broken answer.
 */

/** The most detections the AI service takes in one request (its CLUSTER_MAX_DETECTIONS default). */
export const MAX_DETECTIONS_PER_RUN = 20_000;

export const SEVERITY_NAMES = ['leve', 'moderado', 'grave'] as const;
export type SeverityName = (typeof SEVERITY_NAMES)[number];

/** A detection of the database, as the consolidation reads it. */
export interface ClusterInput {
  id: string;
  latitude: number;
  longitude: number;
  severity: SeverityName;
  confidence: number;
  detectedAt: Date;
}

export interface ClusterParameters {
  epsM: number;
  minPoints: number;
  asOf: Date;
  graphVersion?: string | undefined;
}

export interface AiClusterRequest {
  detections: {
    id: number;
    latitude: number;
    longitude: number;
    severity: SeverityName;
    confidence: number;
    detectedAt: string;
  }[];
  asOf: string;
  epsM: number;
  minPoints: number;
  graphVersion?: string;
}

/** What goes to the AI service: each detection with its position in the list as its number. */
export function buildClusterRequest(
  detections: readonly ClusterInput[],
  parameters: ClusterParameters,
): AiClusterRequest {
  return {
    detections: detections.map((detection, position) => ({
      id: position,
      latitude: detection.latitude,
      longitude: detection.longitude,
      severity: detection.severity,
      confidence: detection.confidence,
      detectedAt: detection.detectedAt.toISOString(),
    })),
    asOf: parameters.asOf.toISOString(),
    epsM: parameters.epsM,
    minPoints: parameters.minPoints,
    ...(parameters.graphVersion === undefined ? {} : { graphVersion: parameters.graphVersion }),
  };
}

const isoDate = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const clusterSchema = z.object({
  detectionIds: z.array(z.number().int().nonnegative()).min(1),
  count: z.number().int().positive(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  severity: z.enum(SEVERITY_NAMES),
  confidence: z.number().min(0).max(1),
  status: z.enum(['confirmed', 'unconfirmed']),
  segmentId: z.number().int().nullable(),
  segmentDistanceM: z.number().nonnegative().nullable(),
  segmentFraction: z.number().min(0).max(1).nullable(),
  firstDetectedAt: isoDate,
  lastDetectedAt: isoDate,
});

/** The answer of the AI service; anything that does not follow it is treated as a failure. */
export const aiClusterResponseSchema = z.object({
  graphVersion: z.string().nullable(),
  asOf: isoDate,
  epsM: z.number().positive(),
  minPoints: z.number().int().positive(),
  detectionCount: z.number().int().nonnegative(),
  clusterCount: z.number().int().nonnegative(),
  confirmedCount: z.number().int().nonnegative(),
  placedCount: z.number().int().nonnegative(),
  computationMs: z.number().int().nonnegative(),
  clusters: z.array(clusterSchema),
});

export type AiClusterResponse = z.infer<typeof aiClusterResponseSchema>;

/** A pothole the AI service built, with the detections of the database it came from. */
export interface FoundCluster {
  detectionIds: string[];
  count: number;
  latitude: number;
  longitude: number;
  severity: SeverityName;
  confidence: number;
  confirmed: boolean;
  segmentId: number | null;
  firstDetectedAt: Date;
  lastDetectedAt: Date;
}

export class BrokenClusterAnswerError extends Error {}

/**
 * Turns the answer back into clusters of real detections. It refuses an answer that does not
 * make sense: a number that is not a detection that was sent, a detection in two clusters, or
 * a count that is not the number of detections of the cluster.
 */
export function readClusters(
  answer: AiClusterResponse,
  sent: readonly ClusterInput[],
): FoundCluster[] {
  const used = new Set<number>();
  return answer.clusters.map((cluster) => {
    if (cluster.count !== cluster.detectionIds.length) {
      throw new BrokenClusterAnswerError('a cluster counts a different number of detections');
    }
    const detectionIds = cluster.detectionIds.map((position) => {
      const detection = sent[position];
      if (detection === undefined) {
        throw new BrokenClusterAnswerError(`detection ${position} was never sent`);
      }
      if (used.has(position)) {
        throw new BrokenClusterAnswerError(`detection ${position} is in two clusters`);
      }
      used.add(position);
      return detection.id;
    });
    return {
      detectionIds,
      count: cluster.count,
      latitude: cluster.latitude,
      longitude: cluster.longitude,
      severity: cluster.severity,
      confidence: cluster.confidence,
      confirmed: cluster.status === 'confirmed',
      segmentId: cluster.segmentId,
      firstDetectedAt: cluster.firstDetectedAt,
      lastDetectedAt: cluster.lastDetectedAt,
    };
  });
}

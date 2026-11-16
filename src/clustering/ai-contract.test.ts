import { describe, expect, it } from 'vitest';
import {
  BrokenClusterAnswerError,
  aiClusterResponseSchema,
  buildClusterRequest,
  readClusters,
  type ClusterInput,
} from './ai-contract.js';

const AT = new Date('2026-11-16T12:00:00.000Z');

function input(n: number): ClusterInput {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    latitude: 1.2136 + n / 1e6,
    longitude: -77.2811,
    severity: 'moderado',
    confidence: 0.8,
    detectedAt: new Date(AT.getTime() - n * 1000),
  };
}

function answer(clusters: unknown[]) {
  return aiClusterResponseSchema.parse({
    graphVersion: null,
    asOf: AT.toISOString(),
    epsM: 5,
    minPoints: 2,
    detectionCount: 3,
    clusterCount: clusters.length,
    confirmedCount: 1,
    placedCount: 0,
    computationMs: 4,
    clusters,
  });
}

function cluster(detectionIds: number[], change: Record<string, unknown> = {}) {
  return {
    detectionIds,
    count: detectionIds.length,
    latitude: 1.2136,
    longitude: -77.2811,
    severity: 'moderado',
    confidence: 0.9,
    status: 'confirmed',
    segmentId: 7,
    segmentDistanceM: 3,
    segmentFraction: 0.5,
    firstDetectedAt: '2026-11-10T10:00:00Z',
    lastDetectedAt: '2026-11-12T10:00:00+00:00',
    ...change,
  };
}

describe('buildClusterRequest', () => {
  it('numbers the detections by their position and never sends the UUID', () => {
    const request = buildClusterRequest([input(5), input(9)], {
      epsM: 5,
      minPoints: 2,
      asOf: AT,
    });
    expect(request.detections.map((d) => d.id)).toEqual([0, 1]);
    expect(JSON.stringify(request)).not.toContain('0000-4000');
    expect(request.detections[0]?.detectedAt).toBe(new Date(AT.getTime() - 5000).toISOString());
    expect(request.asOf).toBe(AT.toISOString());
    expect(request).not.toHaveProperty('graphVersion');
  });

  it('adds the graph version only when there is one', () => {
    const request = buildClusterRequest([], {
      epsM: 5,
      minPoints: 2,
      asOf: AT,
      graphVersion: 'v1',
    });
    expect(request.graphVersion).toBe('v1');
    expect(request.detections).toEqual([]);
  });
});

describe('readClusters', () => {
  const sent = [input(1), input(2), input(3)];

  it('gives each cluster the UUIDs of its detections', () => {
    const [first, second] = readClusters(
      answer([cluster([2, 0]), cluster([1], { status: 'unconfirmed' })]),
      sent,
    );
    expect(first?.detectionIds).toEqual([sent[2]?.id, sent[0]?.id]);
    expect(first?.confirmed).toBe(true);
    expect(first?.segmentId).toBe(7);
    expect(first?.lastDetectedAt).toEqual(new Date('2026-11-12T10:00:00Z'));
    expect(second?.confirmed).toBe(false);
  });

  it('refuses a number that was never sent', () => {
    expect(() => readClusters(answer([cluster([3])]), sent)).toThrow(BrokenClusterAnswerError);
  });

  it('refuses a detection in two clusters', () => {
    expect(() => readClusters(answer([cluster([0, 1]), cluster([1])]), sent)).toThrow(
      /two clusters/,
    );
  });

  it('refuses a count that does not match the detections', () => {
    expect(() => readClusters(answer([cluster([0, 1], { count: 5 })]), sent)).toThrow(
      /different number/,
    );
  });
});

describe('aiClusterResponseSchema', () => {
  it('refuses a date without a time zone', () => {
    expect(() => answer([cluster([0], { firstDetectedAt: '2026-11-10T10:00:00' })])).toThrow();
  });

  it('refuses an unknown severity or status', () => {
    expect(() => answer([cluster([0], { severity: 'enorme' })])).toThrow();
    expect(() => answer([cluster([0], { status: 'maybe' })])).toThrow();
  });
});

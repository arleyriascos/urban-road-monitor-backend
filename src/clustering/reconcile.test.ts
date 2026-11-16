import { describe, expect, it } from 'vitest';
import type { FoundCluster } from './ai-contract.js';
import { reconcile, type ReconcileInput } from './reconcile.js';
import type { ExistingPothole } from './status.js';

const T = new Date('2026-11-10T10:00:00Z');

function counter() {
  let n = 0;
  return () => `new-${++n}`;
}

function cluster(
  ids: string[],
  latitude = 1.2136,
  change: Partial<FoundCluster> = {},
): FoundCluster {
  return {
    detectionIds: ids,
    count: ids.length,
    latitude,
    longitude: -77.2811,
    severity: 'moderado',
    confidence: 0.8,
    confirmed: ids.length > 1,
    segmentId: 1,
    firstDetectedAt: T,
    lastDetectedAt: T,
    ...change,
  };
}

function pothole(
  id: string,
  latitude = 1.2136,
  change: Partial<ExistingPothole> = {},
): ExistingPothole {
  return {
    id,
    latitude,
    longitude: -77.2811,
    statusName: 'confirmado',
    repairedAt: null,
    segmentId: 1,
    ...change,
  };
}

function run(change: Partial<ReconcileInput>): ReturnType<typeof reconcile> {
  return reconcile({
    clusters: [],
    existing: [],
    previousPothole: new Map(),
    maxMatchDistanceM: 5,
    newId: counter(),
    ...change,
  });
}

describe('reconcile', () => {
  it('makes a new pothole of a cluster that no old pothole claims', () => {
    const plan = run({ clusters: [cluster(['a', 'b'])] });
    expect(plan.potholes).toHaveLength(1);
    expect(plan.potholes[0]).toMatchObject({ id: 'new-1', isNew: true, status: 'confirmado' });
    expect(plan.removedIds).toEqual([]);
  });

  it('keeps the id of the pothole most of the detections belonged to', () => {
    const plan = run({
      clusters: [cluster(['a', 'b', 'c'])],
      existing: [pothole('P1'), pothole('P2')],
      previousPothole: new Map([
        ['a', 'P2'],
        ['b', 'P2'],
        ['c', 'P1'],
      ]),
    });
    expect(plan.potholes[0]).toMatchObject({ id: 'P2', isNew: false });
    expect(plan.removedIds).toEqual(['P1']);
  });

  it('gives the old pothole to the bigger cluster when a pothole splits in two', () => {
    const plan = run({
      clusters: [cluster(['a'], 1.2137), cluster(['b', 'c', 'd'], 1.2136)],
      existing: [pothole('P1')],
      previousPothole: new Map([
        ['a', 'P1'],
        ['b', 'P1'],
        ['c', 'P1'],
        ['d', 'P1'],
      ]),
    });
    expect(plan.potholes.map((p) => [p.id, p.isNew])).toEqual([
      ['new-1', true],
      ['P1', false],
    ]);
  });

  it('merges two old potholes into the one with more detections', () => {
    const plan = run({
      clusters: [cluster(['a', 'b', 'c'])],
      existing: [pothole('P1'), pothole('P2')],
      previousPothole: new Map([
        ['a', 'P1'],
        ['b', 'P2'],
        ['c', 'P2'],
      ]),
    });
    expect(plan.potholes[0]?.id).toBe('P2');
    expect(plan.removedIds).toEqual(['P1']);
  });

  it('uses the nearest free pothole when the detections say nothing, within the distance', () => {
    const near = run({
      clusters: [cluster(['a', 'b'], 1.21362)],
      existing: [pothole('P1', 1.2136), pothole('P2', 1.2137)],
    });
    expect(near.potholes[0]).toMatchObject({ id: 'P1', isNew: false });

    const far = run({
      clusters: [cluster(['a', 'b'], 1.2137)],
      existing: [pothole('P1', 1.2136)],
    });
    expect(far.potholes[0]?.isNew).toBe(true);
    expect(far.removedIds).toEqual(['P1']);
  });

  it('removes an old pothole nothing points at, but keeps a repaired one', () => {
    const plan = run({
      existing: [pothole('P1'), pothole('P2', 1.2136, { statusName: 'reparado' })],
    });
    expect(plan.removedIds).toEqual(['P1']);
  });

  it('keeps a pothole repaired while no newer detection arrives, and reopens it with one', () => {
    const repaired = pothole('P1', 1.2136, {
      statusName: 'reparado',
      repairedAt: new Date('2026-11-11T00:00:00Z'),
    });
    const votes = new Map([
      ['a', 'P1'],
      ['b', 'P1'],
    ]);
    const stays = run({
      clusters: [cluster(['a', 'b'])],
      existing: [repaired],
      previousPothole: votes,
    });
    expect(stays.potholes[0]).toMatchObject({ id: 'P1', status: 'reparado' });

    const seenAgain = run({
      clusters: [cluster(['a', 'b'], 1.2136, { lastDetectedAt: new Date('2026-11-12T00:00:00Z') })],
      existing: [repaired],
      previousPothole: votes,
    });
    expect(seenAgain.potholes[0]).toMatchObject({ id: 'P1', status: 'confirmado' });
  });

  it('unlinks the detections that are in no cluster', () => {
    const plan = run({
      clusters: [cluster(['a', 'b'])],
      existing: [pothole('P1')],
      previousPothole: new Map<string, string | null>([
        ['a', 'P1'],
        ['b', 'P1'],
        ['c', 'P1'],
        ['d', null],
      ]),
    });
    expect(plan.unlinkedDetectionIds.sort()).toEqual(['c', 'd']);
  });

  it('remembers where each kept pothole was, to work out that segment again', () => {
    const plan = run({
      clusters: [cluster(['a', 'b'])],
      existing: [pothole('P1', 1.2136, { segmentId: 9 })],
      previousPothole: new Map([['a', 'P1']]),
    });
    expect(plan.potholes[0]?.previousSegmentId).toBe(9);
  });

  it('ignores a pothole id that is not in the list of old potholes (a seed pothole)', () => {
    const plan = run({
      clusters: [cluster(['a', 'b'])],
      existing: [],
      previousPothole: new Map([['a', 'SEED']]),
    });
    expect(plan.potholes[0]?.isNew).toBe(true);
  });
});

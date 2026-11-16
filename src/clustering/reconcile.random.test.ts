/**
 * Random runs of the reconciliation. Whatever the clusters and the old potholes are, the plan
 * must make sense, and running it again on its own result must change nothing. The seeds are
 * fixed, so every run does the same.
 */
import { describe, expect, it } from 'vitest';
import type { FoundCluster } from './ai-contract.js';
import { reconcile } from './reconcile.js';
import type { ExistingPothole } from './status.js';

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

const T = new Date('2026-11-10T10:00:00Z');

function scenario(seed: number) {
  const random = seededRandom(seed);
  const pick = (n: number) => Math.floor(random() * n);

  const detectionTotal = 5 + pick(40);
  const detectionIds = Array.from({ length: detectionTotal }, (_, i) => `d${i}`);
  const shuffled = [...detectionIds].sort(() => random() - 0.5);

  const clusters: FoundCluster[] = [];
  let cursor = 0;
  while (cursor < shuffled.length && random() < 0.9) {
    const size = 1 + pick(5);
    const ids = shuffled.slice(cursor, cursor + size);
    cursor += size;
    clusters.push({
      detectionIds: ids,
      count: ids.length,
      latitude: 1.2 + pick(12) * 0.00003,
      longitude: -77.28,
      severity: 'leve',
      confidence: 0.5,
      confirmed: ids.length > 1,
      segmentId: 1 + pick(3),
      firstDetectedAt: T,
      lastDetectedAt: T,
    });
  }

  const existing: ExistingPothole[] = Array.from({ length: pick(10) }, (_, i) => ({
    id: `P${i}`,
    latitude: 1.2 + pick(12) * 0.00003,
    longitude: -77.28,
    statusName: random() < 0.2 ? 'reparado' : 'confirmado',
    repairedAt: new Date('2026-12-01T00:00:00Z'),
    segmentId: 1 + pick(3),
  }));

  const previousPothole = new Map<string, string | null>(
    detectionIds.map((id) => [
      id,
      existing.length > 0 && random() < 0.7 ? `P${pick(existing.length)}` : null,
    ]),
  );
  return { clusters, existing, previousPothole };
}

describe('reconcile (random runs)', () => {
  for (let seed = 1; seed <= 60; seed++) {
    it(`keeps the plan consistent and stable (seed ${seed})`, () => {
      const { clusters, existing, previousPothole } = scenario(seed);
      let next = 0;
      const plan = reconcile({
        clusters,
        existing,
        previousPothole,
        maxMatchDistanceM: 5,
        newId: () => `N${++next}`,
      });

      // One pothole per cluster, and no id twice.
      expect(plan.potholes).toHaveLength(clusters.length);
      const ids = plan.potholes.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);

      // A pothole is never kept and removed in the same run.
      expect(ids.some((id) => plan.removedIds.includes(id))).toBe(false);
      // Only old potholes are removed, and never a repaired one.
      for (const removed of plan.removedIds) {
        const old = existing.find((p) => p.id === removed);
        expect(old).toBeDefined();
        expect(old?.statusName).not.toBe('reparado');
      }
      // Every old pothole is kept, removed, or repaired and left alone.
      for (const old of existing) {
        const kept = ids.includes(old.id);
        const removed = plan.removedIds.includes(old.id);
        expect(kept || removed || old.statusName === 'reparado').toBe(true);
      }
      // A detection is unlinked exactly when it is in no cluster.
      const inCluster = new Set(clusters.flatMap((c) => c.detectionIds));
      expect(new Set(plan.unlinkedDetectionIds)).toEqual(
        new Set([...previousPothole.keys()].filter((id) => !inCluster.has(id))),
      );

      // Running it again on its own result changes nothing.
      const after: ExistingPothole[] = plan.potholes.map((p) => ({
        id: p.id,
        latitude: p.cluster.latitude,
        longitude: p.cluster.longitude,
        statusName: p.status,
        repairedAt: existing.find((old) => old.id === p.id)?.repairedAt ?? null,
        segmentId: p.cluster.segmentId,
      }));
      const linked = new Map<string, string | null>(
        [...previousPothole.keys()].map((id) => [id, null]),
      );
      for (const p of plan.potholes) {
        for (const id of p.cluster.detectionIds) linked.set(id, p.id);
      }
      const again = reconcile({
        clusters,
        existing: after,
        previousPothole: linked,
        maxMatchDistanceM: 5,
        newId: () => `X${++next}`,
      });
      expect(again.potholes.map((p) => [p.id, p.isNew])).toEqual(ids.map((id) => [id, false]));
      expect(again.removedIds).toEqual([]);
    });
  }
});

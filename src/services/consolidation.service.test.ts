import { describe, expect, it, vi } from 'vitest';
import { AiClusterError } from '../clustering/ai-cluster.client.js';
import { aiClusterResponseSchema, type AiClusterRequest } from '../clustering/ai-contract.js';
import type { ReconcilePlan } from '../clustering/reconcile.js';
import type { WindowDetection } from '../repositories/consolidation.repository.js';
import { ConsolidationService, type ConsolidationDependencies } from './consolidation.service.js';

const NOW = new Date('2026-11-16T12:00:00.000Z');

function detection(n: number, potholeId: string | null = null): WindowDetection {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    latitude: 1.2,
    longitude: -77.28,
    severity: 'grave',
    confidence: 0.9,
    detectedAt: new Date(NOW.getTime() - n * 60_000),
    potholeId,
  };
}

function answer(clusters: unknown[]) {
  return aiClusterResponseSchema.parse({
    graphVersion: 'v1',
    asOf: NOW.toISOString(),
    epsM: 5,
    minPoints: 2,
    detectionCount: 2,
    clusterCount: clusters.length,
    confirmedCount: clusters.length,
    placedCount: 0,
    computationMs: 3,
    clusters,
  });
}

function cluster(ids: number[]) {
  return {
    detectionIds: ids,
    count: ids.length,
    latitude: 1.2,
    longitude: -77.28,
    severity: 'grave',
    confidence: 0.9,
    status: 'confirmed',
    segmentId: null,
    segmentDistanceM: null,
    segmentFraction: null,
    firstDetectedAt: '2026-11-15T10:00:00Z',
    lastDetectedAt: '2026-11-15T11:00:00Z',
  };
}

function setup(
  change: Partial<ConsolidationDependencies> & { detections?: WindowDetection[] } = {},
) {
  const calls: AiClusterRequest[] = [];
  const plans: ReconcilePlan[] = [];
  const runs = {
    start: vi.fn(async () => 7 as number | null),
    finish: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
    abandonStale: vi.fn(async () => 0),
  };
  const store = {
    loadDetections: vi.fn(async () => change.detections ?? [detection(1), detection(2)]),
    loadDerivedPotholes: vi.fn(async () => []),
    apply: vi.fn(async (plan: ReconcilePlan) => {
      plans.push(plan);
      return {
        created: plan.potholes.filter((p) => p.isNew).length,
        updated: 0,
        removed: plan.removedIds.length,
        segmentsChanged: 2,
      };
    }),
  };
  const deps: ConsolidationDependencies = {
    runs,
    store,
    parameters: { getNumber: vi.fn(async (_key: string, fallback: number) => fallback) },
    versions: { current: async () => 'graph-v1' },
    ai: {
      cluster: async (request) => {
        calls.push(request);
        return answer([cluster([0, 1])]);
      },
    },
    clock: () => NOW,
    newId: () => 'new-pothole',
    ...change,
  };
  return { service: new ConsolidationService(deps), runs, store, calls, plans };
}

describe('ConsolidationService.run', () => {
  it('groups the detections, writes the plan and records a finished run', async () => {
    const { service, runs, calls, plans } = setup();
    const outcome = await service.run('automatic');

    expect(outcome).toEqual({
      kind: 'finished',
      runId: 7,
      segmentsChanged: 2,
      stats: {
        detectionsProcessed: 2,
        clustersFound: 1,
        potholesCreated: 1,
        potholesUpdated: 0,
        potholesRemoved: 0,
      },
    });
    expect(plans[0]?.potholes[0]).toMatchObject({ id: 'new-pothole', status: 'confirmado' });
    expect(plans[0]?.potholes[0]?.cluster.detectionIds).toEqual([detection(1).id, detection(2).id]);
    expect(runs.finish).toHaveBeenCalledWith(7, expect.objectContaining({ clustersFound: 1 }), NOW);
    expect(calls[0]).toMatchObject({ epsM: 5, minPoints: 2, graphVersion: 'graph-v1' });
    expect(calls[0]?.asOf).toBe(NOW.toISOString());
  });

  it('reads the parameters of the administrator and the window of days', async () => {
    const { service, runs, store } = setup({
      parameters: {
        getNumber: async (key: string, fallback: number) =>
          ({ dbscan_eps_meters: 8, dbscan_min_points: 3, clustering_window_days: 30 })[key] ??
          fallback,
      },
    });
    await service.run('manual', 'user-1');
    expect(runs.start).toHaveBeenCalledWith({
      trigger: 'manual',
      requestedBy: 'user-1',
      epsM: 8,
      minPoints: 3,
      windowDays: 30,
      startedAt: NOW,
    });
    expect(store.loadDetections).toHaveBeenCalledWith(
      new Date(NOW.getTime() - 30 * 86_400_000),
      20_000,
    );
  });

  it('abandons runs that were left running by a server that stopped', async () => {
    const { service, runs } = setup();
    await service.run('automatic');
    expect(runs.abandonStale).toHaveBeenCalledWith(new Date(NOW.getTime() - 10 * 60_000), NOW);
  });

  it('does nothing when another run is already running', async () => {
    const { service, runs, store } = setup();
    runs.start.mockResolvedValueOnce(null);
    expect(await service.run('automatic')).toEqual({ kind: 'busy' });
    expect(store.loadDetections).not.toHaveBeenCalled();
  });

  it('does not wake the AI service when there is nothing to group, and still tidies the potholes', async () => {
    const ai = { cluster: vi.fn() };
    const { service, plans } = setup({ detections: [], ai });
    const outcome = await service.run('automatic');
    expect(outcome.kind).toBe('finished');
    expect(ai.cluster).not.toHaveBeenCalled();
    expect(plans).toHaveLength(1);
  });

  it('says it is not configured, and writes nothing, without the AI service', async () => {
    const { service, runs } = setup({ ai: null });
    expect(service.isConfigured).toBe(false);
    expect(await service.run('automatic')).toEqual({ kind: 'not_configured' });
    expect(runs.start).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: 'hibernating', routing: 'hibernate-rate-limited' } as const, 'AI_HIBERNATING'],
    [{ kind: 'unavailable', reason: 'no connection' } as const, 'AI_UNAVAILABLE'],
    [{ kind: 'rejected', code: 'TOO_MANY_DETECTIONS' } as const, 'AI_REJECTED'],
  ])('records a failed run when the AI service fails (%j)', async (failure, code) => {
    const { service, runs, store } = setup({
      ai: {
        cluster: async () => {
          throw new AiClusterError(failure);
        },
      },
    });
    const outcome = await service.run('automatic');
    expect(outcome).toMatchObject({ kind: 'failed', runId: 7, code });
    expect(runs.fail).toHaveBeenCalledWith(7, code, expect.any(String), NOW);
    expect(store.apply).not.toHaveBeenCalled();
  });

  it('records a failed run when the AI service answers nonsense', async () => {
    const { service } = setup({ ai: { cluster: async () => answer([cluster([5])]) } });
    expect(await service.run('automatic')).toMatchObject({
      kind: 'failed',
      code: 'AI_BROKEN_ANSWER',
    });
  });

  it('records a database failure without telling the details to the caller', async () => {
    const { service, store, runs } = setup();
    store.apply.mockRejectedValueOnce(new Error('connection to 10.0.0.5 lost'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const outcome = await service.run('automatic');
    expect(outcome).toMatchObject({ kind: 'failed', code: 'DATABASE_ERROR' });
    expect(JSON.stringify(outcome)).not.toContain('10.0.0.5');
    expect(runs.fail).toHaveBeenCalled();
  });

  it('keeps the old id of a pothole whose detections were linked to it', async () => {
    const { service, plans, store } = setup({
      detections: [detection(1, 'P1'), detection(2, 'P1')],
    });
    store.loadDerivedPotholes.mockResolvedValueOnce([
      {
        id: 'P1',
        latitude: 1.2,
        longitude: -77.28,
        statusName: 'sin confirmar',
        repairedAt: null,
        segmentId: null,
      },
    ] as never);
    await service.run('automatic');
    expect(plans[0]?.potholes[0]).toMatchObject({ id: 'P1', isNew: false, status: 'confirmado' });
  });
});

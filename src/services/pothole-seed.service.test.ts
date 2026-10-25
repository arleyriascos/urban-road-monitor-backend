import { describe, expect, it, vi } from 'vitest';
import type { TargetDescription } from '../config/database-target.js';
import { buildGrid, testCatalogs } from '../seed/__fixtures__/grid.js';
import type { SeedPlan, SeedSummary } from '../seed/types.js';
import { PotholeSeedService, type PotholeSeedStore } from './pothole-seed.service.js';

const target: TargetDescription = { host: 'ep-dev-1.neon.tech', database: 'urban_road_monitor' };
const summary: SeedSummary = {
  deletedPotholes: 0,
  insertedPotholes: 60,
  segmentsReset: 0,
  segmentsWithDamage: 40,
};
const NOW = new Date('2026-10-25T12:00:00.000Z');
const allowedEnvironment = { nodeEnv: 'development', allowedHost: 'ep-dev-1.neon.tech' };

function createStore(
  options: { detections?: number; segments?: ReturnType<typeof buildGrid> } = {},
) {
  const replaced: SeedPlan[] = [];
  const store: PotholeSeedStore = {
    describeTarget: () => target,
    countDetections: vi.fn(async () => options.detections ?? 0),
    loadInput: vi.fn(async () => ({
      segments: options.segments ?? buildGrid(),
      catalogs: testCatalogs,
    })),
    replaceAll: vi.fn(async (plan: SeedPlan) => {
      replaced.push(plan);
      return summary;
    }),
  };
  return { store, replaced };
}

const run = { dryRun: false, count: 60, seed: 2026 };

describe('PotholeSeedService', () => {
  it('only shows the plan in dry-run mode, without guards, confirmation or writing', async () => {
    const { store, replaced } = createStore();
    const confirm = vi.fn();
    const service = new PotholeSeedService({
      store,
      confirm,
      environment: { nodeEnv: 'production', allowedHost: undefined },
      now: () => NOW,
    });

    const outcome = await service.run({ ...run, dryRun: true });

    expect(outcome.status).toBe('dry-run');
    expect(outcome.plan.potholes).toHaveLength(60);
    expect(confirm).not.toHaveBeenCalled();
    expect(replaced).toHaveLength(0);
  });

  it('asks for confirmation with the target and then replaces the potholes', async () => {
    const { store, replaced } = createStore();
    const confirm = vi.fn(async () => true);
    const service = new PotholeSeedService({
      store,
      confirm,
      environment: allowedEnvironment,
      now: () => NOW,
    });

    const outcome = await service.run(run);

    expect(confirm).toHaveBeenCalledWith(target);
    expect(outcome).toMatchObject({ status: 'saved', summary });
    expect(replaced).toHaveLength(1);
    expect(replaced[0].potholes).toHaveLength(60);
  });

  it('writes nothing when the person does not confirm', async () => {
    const { store, replaced } = createStore();
    const service = new PotholeSeedService({
      store,
      confirm: async () => false,
      environment: allowedEnvironment,
      now: () => NOW,
    });

    expect((await service.run(run)).status).toBe('cancelled');
    expect(replaced).toHaveLength(0);
  });

  it.each([
    ['in production', { nodeEnv: 'production', allowedHost: 'ep-dev-1.neon.tech' }, 'production'],
    [
      'without SEED_ALLOWED_HOST',
      { nodeEnv: 'development', allowedHost: undefined },
      'SEED_ALLOWED_HOST',
    ],
    [
      'on another server',
      { nodeEnv: 'development', allowedHost: 'ep-other.neon.tech' },
      'no es el servidor permitido',
    ],
  ])('refuses %s before reading or writing anything', async (_label, environment, message) => {
    const { store, replaced } = createStore();
    const service = new PotholeSeedService({ store, confirm: async () => true, environment });

    await expect(service.run(run)).rejects.toThrow(message);
    expect(store.loadInput).not.toHaveBeenCalled();
    expect(replaced).toHaveLength(0);
  });

  it('refuses when there are real detections', async () => {
    const { store, replaced } = createStore({ detections: 3 });
    const service = new PotholeSeedService({
      store,
      confirm: async () => true,
      environment: allowedEnvironment,
    });

    await expect(service.run(run)).rejects.toThrow('3 detecciones');
    expect(replaced).toHaveLength(0);
  });

  it('asks to import the road network first when there are no segments', async () => {
    const { store } = createStore({ segments: [] });
    const service = new PotholeSeedService({
      store,
      confirm: async () => true,
      environment: allowedEnvironment,
    });

    await expect(service.run(run)).rejects.toThrow('Importa primero la red vial');
  });

  it('refuses to write without a confirmation function', async () => {
    const { store } = createStore();
    const service = new PotholeSeedService({ store, environment: allowedEnvironment });

    await expect(service.run(run)).rejects.toThrow('confirmación');
  });

  it('logs the plan', async () => {
    const { store } = createStore();
    const log = vi.fn();
    const service = new PotholeSeedService({
      store,
      environment: allowedEnvironment,
      log,
      now: () => NOW,
    });

    await service.run({ ...run, dryRun: true });

    expect(log.mock.calls.flat().join('\n')).toContain('Plan de baches de prueba');
  });
});

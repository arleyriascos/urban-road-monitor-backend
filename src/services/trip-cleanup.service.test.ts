import { describe, expect, it, vi } from 'vitest';
import type { CleanupTrip } from '../trips/cleanup-plan.js';
import { TripCleanupService } from './trip-cleanup.service.js';

function trip(id: string, overrides: Partial<CleanupTrip> = {}): CleanupTrip {
  return {
    id,
    startedAt: new Date('2026-11-16T13:30:00Z'),
    endedAt: null,
    detectionCount: 2,
    detectionsInPotholes: 0,
    ...overrides,
  };
}

function setup(options: { account?: boolean; trips?: CleanupTrip[]; confirm?: boolean } = {}) {
  const store = {
    describeTarget: () => ({ host: 'localhost:5432', database: 'urm_dev' }),
    findAccount: vi.fn(async () =>
      options.account === false ? null : { id: 'user-1', email: 'ana@example.com' },
    ),
    listTrips: vi.fn(async () => options.trips ?? [trip('a'), trip('b')]),
    deleteTrips: vi.fn(async (_userId: string, ids: readonly string[]) => ({
      trips: ids.length,
      detections: ids.length * 2,
    })),
  };
  const confirm = vi.fn(async () => options.confirm ?? true);
  return { service: new TripCleanupService({ store, confirm }), store, confirm };
}

const LOOK = { email: 'ana@example.com', since: null, apply: false };
const APPLY = { ...LOOK, apply: true };

describe('TripCleanupService', () => {
  it('only looks without --aplicar: it says what would go and deletes nothing', async () => {
    const { service, store, confirm } = setup();

    const outcome = await service.run(LOOK);

    expect(outcome.status).toBe('looked');
    expect(outcome.message).toContain('Se borrarían 2 viajes y 4 detecciones');
    expect(outcome.message).toContain('--aplicar');
    expect(confirm).not.toHaveBeenCalled();
    expect(store.deleteTrips).not.toHaveBeenCalled();
  });

  it('asks with the database in view, and deletes the trips of the plan when confirmed', async () => {
    const { service, store, confirm } = setup();

    const outcome = await service.run(APPLY);

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ target: { host: 'localhost:5432', database: 'urm_dev' } }),
    );
    expect(store.deleteTrips).toHaveBeenCalledWith('user-1', ['a', 'b']);
    expect(outcome).toMatchObject({ status: 'deleted' });
    expect(outcome.message).toContain('2 viajes y 4 detecciones');
    expect(outcome.message).toContain('urm_dev');
  });

  it('deletes nothing when the person does not confirm', async () => {
    const { service, store } = setup({ confirm: false });

    const outcome = await service.run(APPLY);

    expect(outcome.status).toBe('cancelled');
    expect(store.deleteTrips).not.toHaveBeenCalled();
  });

  it('does not ask anything when there is nothing to delete', async () => {
    const { service, confirm, store } = setup({ trips: [] });

    const outcome = await service.run(APPLY);

    expect(outcome.status).toBe('looked');
    expect(confirm).not.toHaveBeenCalled();
    expect(store.deleteTrips).not.toHaveBeenCalled();
  });

  it('only sends the trips that can go, and tells about the ones that stay', async () => {
    const { service, store } = setup({
      trips: [trip('a'), trip('b', { detectionsInPotholes: 1 })],
    });

    const looked = await service.run(LOOK);
    await service.run(APPLY);

    expect(looked.message).toContain('No se tocan');
    expect(store.deleteTrips).toHaveBeenCalledWith('user-1', ['a']);
  });

  it('refuses an account that does not exist', async () => {
    const { service, store } = setup({ account: false });

    const outcome = await service.run(APPLY);

    expect(outcome.status).toBe('refused');
    expect(outcome.message).toContain('urm_dev');
    expect(store.listTrips).not.toHaveBeenCalled();
  });

  it('passes the day the person asked to the search', async () => {
    const { service, store } = setup();
    const since = new Date('2026-11-16T05:00:00Z');

    await service.run({ ...LOOK, since });

    expect(store.listTrips).toHaveBeenCalledWith('user-1', since);
  });
});

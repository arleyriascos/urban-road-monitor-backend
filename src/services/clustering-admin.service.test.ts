import { describe, expect, it, vi } from 'vitest';
import { ClusteringAdminService } from './clustering-admin.service.js';

const STATUS = { running: false, nextRunAt: null, failuresInARow: 0, pendingDetections: 3 };

function setup(start: 'started' | 'busy' | 'not_configured' = 'started') {
  const coordinator = {
    requestManual: vi.fn(() => start),
    status: vi.fn(async () => STATUS),
  };
  const runs = { list: vi.fn(async () => []) };
  return { service: new ClusteringAdminService(coordinator, runs), coordinator, runs };
}

describe('ClusteringAdminService', () => {
  it('starts a run on behalf of the administrator', () => {
    const { service, coordinator } = setup();
    service.requestRun('admin-1');
    expect(coordinator.requestManual).toHaveBeenCalledWith('admin-1');
  });

  it('answers 409 while a run is going on', () => {
    const { service } = setup('busy');
    expect(() => service.requestRun('admin-1')).toThrowError(
      expect.objectContaining({ statusCode: 409, code: 'RUN_IN_PROGRESS' }),
    );
  });

  it('answers 503 when the AI service is not configured', () => {
    const { service } = setup('not_configured');
    expect(() => service.requestRun('admin-1')).toThrowError(
      expect.objectContaining({ statusCode: 503, code: 'CLUSTERING_UNAVAILABLE' }),
    );
  });

  it('gives the state and the latest runs', async () => {
    const { service, runs } = setup();
    expect(await service.overview(5)).toEqual({ status: STATUS, runs: [] });
    expect(runs.list).toHaveBeenCalledWith(5);
  });

  it('answers 503 when the database does not answer', async () => {
    const { service, runs } = setup();
    runs.list.mockRejectedValueOnce(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(service.overview(5)).rejects.toMatchObject({
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
    });
  });
});

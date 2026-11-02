import { describe, expect, it, vi } from 'vitest';
import type { HealthRepository } from '../repositories/health.repository.js';
import { HealthService } from './health.service.js';

const stats = { hits: 7, misses: 3, evictions: 1, size: 2, capacity: 200 };

describe('HealthService.getHealth', () => {
  it('reports the route cache statistics', async () => {
    const repository = { ping: vi.fn(async () => undefined) } as unknown as HealthRepository;

    const report = await new HealthService(repository, () => stats).getHealth();

    expect(report.status).toBe('ok');
    expect(report.routeCache).toEqual(stats);
  });

  it('still reports them when the database is down', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const repository = {
      ping: vi.fn(async () => {
        throw new Error('connection refused');
      }),
    } as unknown as HealthRepository;

    const report = await new HealthService(repository, () => stats).getHealth();

    expect(report.status).toBe('degraded');
    expect(report.routeCache).toEqual(stats);
    vi.restoreAllMocks();
  });
});

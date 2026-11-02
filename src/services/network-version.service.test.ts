import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error.js';
import { NetworkVersionCache, VERSION_TTL_MS } from './network-version.service.js';

function clock() {
  let time = 1_000_000;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('NetworkVersionCache', () => {
  it('computes the version the first time', async () => {
    const compute = vi.fn(async () => 'v1');
    const cache = new NetworkVersionCache(compute);

    await expect(cache.current()).resolves.toBe('v1');
    expect(compute).toHaveBeenCalledOnce();
  });

  it('reuses the version for 10 seconds', async () => {
    const time = clock();
    const compute = vi.fn(async () => 'v1');
    const cache = new NetworkVersionCache(compute, VERSION_TTL_MS, time.now);
    await cache.current();

    time.advance(VERSION_TTL_MS - 1);
    await cache.current();

    expect(compute).toHaveBeenCalledOnce();
  });

  it('computes it again after 10 seconds', async () => {
    const time = clock();
    const versions = ['v1', 'v2'];
    const compute = vi.fn(async () => versions.shift() ?? 'none');
    const cache = new NetworkVersionCache(compute, VERSION_TTL_MS, time.now);
    await cache.current();

    time.advance(VERSION_TTL_MS);

    await expect(cache.current()).resolves.toBe('v2');
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('simultaneous requests share one computation', async () => {
    let finish: (version: string) => void = () => {};
    const compute = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const cache = new NetworkVersionCache(compute);

    const answers = Promise.all([1, 2, 3, 4, 5].map(() => cache.current()));
    finish('v1');

    await expect(answers).resolves.toEqual(['v1', 'v1', 'v1', 'v1', 'v1']);
    expect(compute).toHaveBeenCalledOnce();
  });

  it('does not keep a failure, so the next request tries again', async () => {
    const compute = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new AppError(503, 'DATABASE_UNAVAILABLE', 'down'))
      .mockResolvedValueOnce('v1');
    const cache = new NetworkVersionCache(compute);

    await expect(cache.current()).rejects.toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
    await expect(cache.current()).resolves.toBe('v1');
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('once expired, a failure is reported instead of reusing the old version', async () => {
    const time = clock();
    const compute = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('v1')
      .mockRejectedValueOnce(new Error('down'));
    const cache = new NetworkVersionCache(compute, VERSION_TTL_MS, time.now);
    await cache.current();
    time.advance(VERSION_TTL_MS);

    await expect(cache.current()).rejects.toThrow('down');
  });
});

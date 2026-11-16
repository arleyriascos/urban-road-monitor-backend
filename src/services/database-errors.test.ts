import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error.js';
import { orUnavailable } from './database-errors.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('orUnavailable', () => {
  it('gives back what the task gives', async () => {
    expect(await orUnavailable('reading', async () => 42)).toBe(42);
  });

  it('turns an unknown failure into a 503 and logs the real one', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const boom = new Error('connection reset');

    const error = await orUnavailable('Could not read trips', async () => {
      throw boom;
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 503, code: 'DATABASE_UNAVAILABLE' });
    expect(log).toHaveBeenCalledWith('Could not read trips:', boom);
  });

  it('lets an AppError through untouched', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const refusal = new AppError(404, 'TRIP_NOT_FOUND', 'No such trip');

    await expect(
      orUnavailable('reading', async () => {
        throw refusal;
      }),
    ).rejects.toBe(refusal);
    expect(log).not.toHaveBeenCalled();
  });
});

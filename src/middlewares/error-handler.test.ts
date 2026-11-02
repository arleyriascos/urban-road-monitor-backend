import type { AddressInfo } from 'node:net';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error.js';
import { errorHandler } from './error-handler.js';

async function answerFor(error: unknown) {
  const app = express();
  app.use(express.json());
  app.post('/fail', () => {
    throw error;
  });
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://localhost:${port}/fail`, { method: 'POST' });
    const body = (await response.json()) as {
      error: { code: string; message: string; details?: unknown };
    };
    return { status: response.status, body };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('errorHandler', () => {
  it('answers an AppError with its status, code and message', async () => {
    const { status, body } = await answerFor(new AppError(503, 'DATABASE_UNAVAILABLE', 'down'));
    expect(status).toBe(503);
    expect(body).toEqual({ error: { code: 'DATABASE_UNAVAILABLE', message: 'down' } });
  });

  it('adds the details of an AppError when it has them', async () => {
    const { body } = await answerFor(
      new AppError(422, 'OUTSIDE_NETWORK', 'too far', { point: 'origin', distanceM: 450 }),
    );
    expect(body.error.details).toEqual({ point: 'origin', distanceM: 450 });
  });

  it('hides an unexpected error behind a 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { status, body } = await answerFor(new Error('a bug'));
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    vi.restoreAllMocks();
  });
});

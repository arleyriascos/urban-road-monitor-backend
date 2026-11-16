import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error.js';
import { errorHandler } from '../middlewares/error-handler.js';
import { RoadSearchController } from './road-search.controller.js';

const MATCH = {
  name: 'Calle 18',
  roadIds: [1, 2],
  segments: 5,
  center: { latitude: 1.2, longitude: -77.3 },
  bounds: { minLatitude: 1.19, maxLatitude: 1.21, minLongitude: -77.31, maxLongitude: -77.29 },
};

function setup() {
  const service = { search: vi.fn(async () => [MATCH]) };
  const controller = new RoadSearchController(service as never);
  const app: Express = express();
  app.get('/roads/search', controller.search);
  app.use(errorHandler);
  return { app, service };
}

async function call(app: Express, path: string) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://localhost:${port}${path}`);
    return {
      status: response.status,
      body: (await response.json()) as {
        error?: { code: string };
        streets?: unknown;
        query?: string;
      },
      cache: response.headers.get('cache-control'),
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('RoadSearchController', () => {
  it('answers the suggestions with the default limit, and lets browsers keep them a minute', async () => {
    const { app, service } = setup();
    const { status, body, cache } = await call(app, '/roads/search?q=cal');
    expect(status).toBe(200);
    expect(cache).toBe('public, max-age=60');
    expect(body).toEqual({ query: 'cal', streets: [MATCH] });
    expect(service.search).toHaveBeenCalledWith('cal', 8);
  });

  it('trims the text and reads the limit', async () => {
    const { app, service } = setup();
    await call(app, '/roads/search?q=%20Calle%2018%20&limit=3');
    expect(service.search).toHaveBeenCalledWith('Calle 18', 3);
  });

  it.each(['', '?q=', '?q=%20%20', '?q=a&limit=0', '?q=a&limit=99', '?q=a&x=1', '?q=a&q=b'])(
    'answers 400 for %j without asking the service',
    async (query) => {
      const { app, service } = setup();
      const { status, body } = await call(app, `/roads/search${query}`);
      expect(status).toBe(400);
      expect(body.error?.code).toBe('INVALID_REQUEST');
      expect(service.search).not.toHaveBeenCalled();
    },
  );

  it('passes on the errors of the service', async () => {
    const { app, service } = setup();
    service.search.mockRejectedValueOnce(new AppError(503, 'DATABASE_UNAVAILABLE', 'down'));
    const { status, body } = await call(app, '/roads/search?q=a');
    expect(status).toBe(503);
    expect(body.error?.code).toBe('DATABASE_UNAVAILABLE');
  });
});

import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { AppError } from '../errors/app-error.js';
import { errorHandler } from '../middlewares/error-handler.js';
import type { RouteRequest } from '../routing/route-request.js';
import type { RouteAnswer, RouteService } from '../services/route.service.js';
import { RouteController } from './route.controller.js';

const answer: RouteAnswer = {
  criterion: 'balanced',
  algorithm: 'astar',
  fromCache: false,
  origin: { nodeId: 1042, latitude: 1.2136, longitude: -77.2811, distanceM: 3.2 },
  destination: { nodeId: 2210, latitude: 1.215, longitude: -77.279, distanceM: 1.1 },
  summary: { lengthM: 224.5, cost: 448.75, steps: 1, exploredNodes: 17, computationMs: 0 },
  route: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 1,
        geometry: {
          type: 'LineString',
          coordinates: [
            [-77.2811, 1.2136],
            [-77.279, 1.215],
          ],
        },
        properties: {
          order: 1,
          segmentId: 11,
          roadName: 'Calle 18',
          reversed: false,
          lengthM: 224.5,
          damageScore: 0,
          cost: 224.5,
        },
      },
    ],
  },
};

const body = {
  origin: { latitude: 1.2136, longitude: -77.2811 },
  destination: { latitude: 1.215, longitude: -77.279 },
};

function appWith(findRoute: RouteService['findRoute']): Express {
  const controller = new RouteController({ findRoute });
  const app = express();
  app.use(express.json());
  app.post('/api/routes', controller.findRoute);
  app.use(errorHandler);
  return app;
}

async function post(app: Express, payload: string | object, path = '/api/routes') {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://localhost:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });
    return { response, json: (await response.json()) as { error?: Record<string, unknown> } };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/routes', () => {
  it('answers the route with "no-store"', async () => {
    const findRoute = vi.fn(async () => answer);
    const { response, json } = await post(appWith(findRoute), { ...body, criterion: 'shortest' });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(json).toEqual(answer);
    const sent = findRoute.mock.calls[0] as unknown as [RouteRequest];
    expect(sent[0]).toMatchObject({ criterion: 'shortest', algorithm: 'astar' });
  });

  it.each([
    [{ ...body, criterion: 'fastest' }, 'criterion'],
    [{ origin: body.origin }, 'destination'],
    [{ ...body, k: 1 }, 'k'],
    [{ ...body, origin: { latitude: 95, longitude: 0 } }, 'origin.latitude'],
  ])('answers 400 INVALID_REQUEST to an invalid body (%#)', async (payload, field) => {
    const findRoute = vi.fn(async () => answer);
    const { response, json } = await post(appWith(findRoute), payload);

    expect(response.status).toBe(400);
    expect(json.error?.code).toBe('INVALID_REQUEST');
    expect(String(json.error?.message)).toContain(field);
    expect(findRoute).not.toHaveBeenCalled();
  });

  it('answers 400 INVALID_JSON to a body that is not JSON', async () => {
    const { response, json } = await post(appWith(vi.fn()), '{not json');

    expect(response.status).toBe(400);
    expect(json.error?.code).toBe('INVALID_JSON');
  });

  it('passes the service errors on with their details', async () => {
    const findRoute = vi.fn(async () => {
      throw new AppError(422, 'OUTSIDE_NETWORK', 'too far', { point: 'origin', distanceM: 450 });
    });
    const { response, json } = await post(appWith(findRoute), body);

    expect(response.status).toBe(422);
    expect(json.error).toEqual({
      code: 'OUTSIDE_NETWORK',
      message: 'too far',
      details: { point: 'origin', distanceM: 450 },
    });
  });
});

describe('POST /api/routes in the whole application', () => {
  it('is mounted, rate limited, and answers 503 while the AI service is not configured', async () => {
    const app = createApp();

    const { response, json } = await post(app, body);

    expect(response.status).toBe(503);
    expect(json.error).toMatchObject({
      code: 'ROUTE_SERVICE_UNAVAILABLE',
      details: { retryable: false },
    });
    expect(response.headers.get('cache-control')).toBeNull();
  });

  it('limits each client by the True-Client-IP that Render sets', async () => {
    const app = createApp();
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const ask = (clientIp: string) =>
      fetch(`http://localhost:${port}/api/routes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'true-client-ip': clientIp },
        body: JSON.stringify(body),
      });
    try {
      for (let i = 0; i < 30; i++) await ask('198.51.100.1');
      const blocked = await ask('198.51.100.1');
      const otherClient = await ask('198.51.100.2');

      expect(blocked.status).toBe(429);
      // Every request comes from the same connection; only the header tells clients apart.
      expect(otherClient.status).toBe(503);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

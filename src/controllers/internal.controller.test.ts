import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error.js';
import { compressionMiddleware } from '../middlewares/compression.js';
import { errorHandler } from '../middlewares/error-handler.js';
import { requireInternalToken } from '../middlewares/internal-auth.js';
import { notFoundHandler } from '../middlewares/not-found.js';
import type { RoadGraph, RoadGraphService } from '../services/road-graph.service.js';
import { InternalController } from './internal.controller.js';

const TOKEN = '0123456789abcdef'.repeat(4);

const graph: RoadGraph = {
  version: '940ab0350236d4a94de0b11d6ed78931',
  nodes: Array.from({ length: 300 }, (_, i) => ({
    id: i + 1,
    latitude: 1.2 + i / 10_000,
    longitude: -77.28,
  })),
  segments: Array.from({ length: 299 }, (_, i) => ({
    id: i + 1,
    fromNodeId: i + 1,
    toNodeId: i + 2,
    lengthM: 11.12,
    damageScore: i % 10 === 0 ? 0.5 : 0,
    isOneway: i % 3 === 0,
  })),
};

/** Same order of middlewares as app.ts, with a fake service. */
function createApp(getGraph: RoadGraphService['getGraph']) {
  const controller = new InternalController({ getGraph } as RoadGraphService);
  const app = express();
  app.use(compressionMiddleware);
  app.use('/internal', requireInternalToken(TOKEN));
  app.get('/internal/graph', controller.getRoadGraph);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

async function withServer<T>(app: Express, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await run(`http://localhost:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const authorized = { authorization: `Bearer ${TOKEN}` };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InternalController over HTTP', () => {
  it('serves the road graph as JSON with "no-store"', async () => {
    const app = createApp(vi.fn(async () => graph));
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/internal/graph`, { headers: authorized });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual(graph);
    });
  });

  it('compresses the graph with gzip when the client asks for it', async () => {
    const app = createApp(vi.fn(async () => graph));
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/internal/graph`, {
        headers: { ...authorized, 'accept-encoding': 'gzip' },
      });
      expect(response.headers.get('content-encoding')).toBe('gzip');
      const body = (await response.json()) as RoadGraph;
      expect(body.segments).toHaveLength(299);
    });
  });

  it('does not read the graph without the token', async () => {
    const getGraph = vi.fn(async () => graph);
    await withServer(createApp(getGraph), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/internal/graph`);
      expect(response.status).toBe(401);
    });
    expect(getGraph).not.toHaveBeenCalled();
  });

  it('answers 503 when the database is not available', async () => {
    const app = createApp(
      vi.fn(async () => {
        throw new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not available right now');
      }),
    );
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/internal/graph`, { headers: authorized });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'The database is not available right now',
        },
      });
    });
  });
});

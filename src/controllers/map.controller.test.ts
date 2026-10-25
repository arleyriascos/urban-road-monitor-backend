import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../middlewares/error-handler.js';
import type { MapDataService } from '../services/map-data.service.js';
import { MapController } from './map.controller.js';

const collection = { type: 'FeatureCollection', features: [] };
const stats = { roads: 1, segments: 2, totalLengthKm: 0.2 };

function createApp() {
  const service = {
    getRoadSegments: vi.fn(async () => collection),
    getPotholes: vi.fn(async () => collection),
    getNetworkStats: vi.fn(async () => stats),
  };
  const controller = new MapController(service as unknown as MapDataService);

  const app = express();
  app.get('/road-segments', controller.getRoadSegments);
  app.get('/potholes', controller.getPotholes);
  app.get('/road-network/stats', controller.getNetworkStats);
  app.use(errorHandler);
  return { app, service };
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

describe('MapController over HTTP', () => {
  it('serves the road segments as JSON with "no-cache" and an ETag', async () => {
    const { app } = createApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/road-segments`);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect(response.headers.get('etag')).toBeTruthy();
      expect(await response.json()).toEqual(collection);
    });
  });

  it('answers 304 when the ETag has not changed', async () => {
    const { app } = createApp();
    await withServer(app, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/road-segments`);
      const etag = first.headers.get('etag') ?? '';
      // fetch adds "Cache-Control: no-cache" to conditional requests, which a browser does
      // not do when it revalidates, so this request is sent with the plain HTTP client.
      const status = await new Promise<number>((resolve, reject) => {
        request(`${baseUrl}/road-segments`, { headers: { 'if-none-match': etag } }, (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        })
          .on('error', reject)
          .end();
      });
      expect(status).toBe(304);
    });
  });

  it('leaves repaired potholes out by default', async () => {
    const { app, service } = createApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/potholes`);
      expect(response.status).toBe(200);
    });
    expect(service.getPotholes).toHaveBeenCalledWith({ includeRepaired: false });
  });

  it('includes repaired potholes with includeRepaired=true', async () => {
    const { app, service } = createApp();
    await withServer(app, async (baseUrl) => {
      await fetch(`${baseUrl}/potholes?includeRepaired=true`);
    });
    expect(service.getPotholes).toHaveBeenCalledWith({ includeRepaired: true });
  });

  it('rejects an invalid includeRepaired with 400 and a JSON error', async () => {
    const { app, service } = createApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/potholes?includeRepaired=maybe`);
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('INVALID_QUERY');
      expect(body.error.message).toContain('includeRepaired');
    });
    expect(service.getPotholes).not.toHaveBeenCalled();
  });

  it('serves the network stats', async () => {
    const { app } = createApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/road-network/stats`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(stats);
    });
  });

  it('turns a service failure into a JSON 500', async () => {
    const { app, service } = createApp();
    service.getRoadSegments.mockRejectedValueOnce(new Error('boom'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/road-segments`);
      expect(response.status).toBe(500);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
    quiet.mockRestore();
  });
});

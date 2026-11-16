import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error.js';
import { errorHandler } from '../middlewares/error-handler.js';
import { RoadSummaryController } from './road-summary.controller.js';

const STRETCH = {
  roadId: 7,
  roadName: 'Calle 7',
  fromSegmentIndex: 0,
  toSegmentIndex: 4,
  summary: { segments: 5 },
};

function setup() {
  const service = {
    segmentWindow: vi.fn(async () => ({
      segment: { id: 42 },
      radius: 2,
      window: STRETCH,
      road: STRETCH,
    })),
    road: vi.fn(async () => STRETCH),
  };
  const controller = new RoadSummaryController(service as never);
  const app: Express = express();
  app.get('/road-segments/:id/summary', controller.segment);
  app.get('/roads/:id/summary', controller.road);
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
      body: (await response.json()) as { error?: { code: string; message: string } },
      cache: response.headers.get('cache-control'),
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('RoadSummaryController', () => {
  it('answers the window of a segment, with the default radius, and lets browsers keep it 10 s', async () => {
    const { app, service } = setup();
    const { status, cache } = await call(app, '/road-segments/42/summary');
    expect(status).toBe(200);
    expect(cache).toBe('public, max-age=10');
    expect(service.segmentWindow).toHaveBeenCalledWith(42, 2);
  });

  it('reads the radius from the query', async () => {
    const { app, service } = setup();
    await call(app, '/road-segments/42/summary?radius=5');
    expect(service.segmentWindow).toHaveBeenCalledWith(42, 5);
  });

  it('answers a whole street, or the range that was asked', async () => {
    const { app, service } = setup();
    expect((await call(app, '/roads/7/summary')).status).toBe(200);
    expect(service.road).toHaveBeenLastCalledWith(7, undefined);
    await call(app, '/roads/7/summary?from=2&to=6');
    expect(service.road).toHaveBeenLastCalledWith(7, { from: 2, to: 6 });
  });

  it('answers 400 with what is wrong, and does not call the service', async () => {
    const { app, service } = setup();
    const bad = await call(app, '/road-segments/abc/summary');
    expect(bad.status).toBe(400);
    expect(bad.body.error?.code).toBe('INVALID_REQUEST');
    expect(bad.body.error?.message).toContain('id');
    expect((await call(app, '/road-segments/1/summary?radius=99')).status).toBe(400);
    expect((await call(app, '/roads/1/summary?from=3')).status).toBe(400);
    expect(service.segmentWindow).not.toHaveBeenCalled();
    expect(service.road).not.toHaveBeenCalled();
  });

  it('passes on a 404 of the service', async () => {
    const { app, service } = setup();
    service.road.mockRejectedValueOnce(new AppError(404, 'ROAD_NOT_FOUND', 'There is no street'));
    const { status, body } = await call(app, '/roads/999/summary');
    expect(status).toBe(404);
    expect(body.error?.code).toBe('ROAD_NOT_FOUND');
  });
});

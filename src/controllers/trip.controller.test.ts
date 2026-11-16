import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error.js';
import { errorHandler } from '../middlewares/error-handler.js';
import { TripController } from './trip.controller.js';

const TRIP_ID = '11111111-1111-4111-8111-111111111111';
const DETECTION = {
  id: '22222222-2222-4222-8222-222222222222',
  latitude: 4.60971,
  longitude: -74.08175,
  confidence: 0.8,
  bboxAreaRatio: 0.02,
  detectedAt: '2026-11-16T12:00:00.000Z',
};

function setup() {
  const trips = {
    start: vi.fn(async () => ({ tripId: TRIP_ID })),
    finish: vi.fn(async () => ({ id: TRIP_ID })),
    list: vi.fn(async () => ({ trips: [], nextCursor: null })),
    get: vi.fn(async () => ({ id: TRIP_ID })),
  };
  const ingest = {
    ingest: vi.fn(async () => ({ received: 1, stored: 1, duplicates: 0, rejected: [] })),
  };
  const controller = new TripController(trips as never, ingest as never);
  const app: Express = express();
  app.use(express.json());
  // The session check is the job of the middlewares: here the person is already known.
  app.use((_req, res, next) => {
    res.locals.auth = { userId: 'user-1', email: 'a@b.c' };
    next();
  });
  app.post('/trips', controller.start);
  app.patch('/trips/:id', controller.finish);
  app.get('/trips', controller.list);
  app.get('/trips/:id', controller.get);
  app.post('/trips/:tripId/detections', controller.addDetections);
  app.use(errorHandler);
  return { app, trips, ingest };
}

async function call(app: Express, method: string, path: string, body?: unknown) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://localhost:${port}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { response, json: (await response.json()) as Record<string, unknown> };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('TripController', () => {
  it('starts a trip: 201 and no-store, for the person of the session', async () => {
    const { app, trips } = setup();

    const { response, json } = await call(app, 'POST', '/trips', {
      device: { platform: 'android' },
      modelVersion: '1.0.0',
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(json).toEqual({ tripId: TRIP_ID });
    expect(trips.start).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ modelVersion: '1.0.0' }),
    );
  });

  it('answers 400 to a trip that does not say its platform', async () => {
    const { app, trips } = setup();

    const { response, json } = await call(app, 'POST', '/trips', { device: {}, modelVersion: '1' });

    expect(response.status).toBe(400);
    expect(json).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    expect(trips.start).not.toHaveBeenCalled();
  });

  it('closes a trip with its counters', async () => {
    const { app, trips } = setup();

    const { response } = await call(app, 'PATCH', `/trips/${TRIP_ID}`, {
      framesAnalyzed: 100,
      distanceM: 500,
    });

    expect(response.status).toBe(200);
    expect(trips.finish).toHaveBeenCalledWith('user-1', TRIP_ID, {
      framesAnalyzed: 100,
      distanceM: 500,
    });
  });

  it('lists with the limit and the cursor of the query string', async () => {
    const { app, trips } = setup();

    await call(app, 'GET', '/trips?limit=5&cursor=abc');

    expect(trips.list).toHaveBeenCalledWith('user-1', 5, 'abc');
  });

  it('answers 400 to a limit out of range', async () => {
    const { app, trips } = setup();

    const { response } = await call(app, 'GET', '/trips?limit=500');

    expect(response.status).toBe(400);
    expect(trips.list).not.toHaveBeenCalled();
  });

  it('reads one trip', async () => {
    const { app, trips } = setup();

    const { json } = await call(app, 'GET', `/trips/${TRIP_ID}`);

    expect(json).toEqual({ id: TRIP_ID });
    expect(trips.get).toHaveBeenCalledWith('user-1', TRIP_ID);
  });

  it('passes the errors of the service on, with their status', async () => {
    const { app, trips } = setup();
    trips.get.mockRejectedValue(
      new AppError(404, 'TRIP_NOT_FOUND', 'No trip of yours has that id'),
    );

    const { response, json } = await call(app, 'GET', `/trips/${TRIP_ID}`);

    expect(response.status).toBe(404);
    expect(json).toMatchObject({ error: { code: 'TRIP_NOT_FOUND' } });
  });

  it('receives a batch of detections and answers what was stored', async () => {
    const { app, ingest } = setup();

    const { response, json } = await call(app, 'POST', `/trips/${TRIP_ID}/detections`, {
      detections: [DETECTION],
    });

    expect(response.status).toBe(200);
    expect(json).toEqual({ received: 1, stored: 1, duplicates: 0, rejected: [] });
    expect(ingest.ingest).toHaveBeenCalledWith('user-1', TRIP_ID, expect.anything());
  });

  it('answers 400 to an empty batch, a repeated id or a field nobody asked for', async () => {
    const { app, ingest } = setup();
    const path = `/trips/${TRIP_ID}/detections`;

    expect((await call(app, 'POST', path, { detections: [] })).response.status).toBe(400);
    expect(
      (await call(app, 'POST', path, { detections: [DETECTION, DETECTION] })).response.status,
    ).toBe(400);
    expect(
      (await call(app, 'POST', path, { detections: [{ ...DETECTION, severity: 'grave' }] }))
        .response.status,
    ).toBe(400);
    expect(ingest.ingest).not.toHaveBeenCalled();
  });
});

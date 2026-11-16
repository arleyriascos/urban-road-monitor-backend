import type { AddressInfo } from 'node:net';
import express, { type Request, type RequestHandler, type Response } from 'express';
import { describe, expect, it } from 'vitest';
import { createTripRouter } from './trip.routes.js';

function setup() {
  const calls: string[] = [];
  const mark =
    (name: string): RequestHandler =>
    (_req, _res, next) => {
      calls.push(name);
      next();
    };
  const handler = (name: string) => async (_req: Request, res: Response) => {
    calls.push(name);
    res.status(204).end();
  };
  const router = createTripRouter(
    {
      start: handler('start'),
      finish: handler('finish'),
      list: handler('list'),
      get: handler('get'),
      addDetections: handler('addDetections'),
    },
    { trips: mark('trips-limit'), detections: mark('detections-limit') },
    { create: mark('create'), viewOwn: mark('view-own') },
  );
  const app = express();
  app.use('/api', router);
  return { app, calls };
}

async function send(app: express.Express, method: string, path: string) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return (await fetch(`http://localhost:${port}${path}`, { method })).status;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('createTripRouter', () => {
  it.each([
    ['POST', '/api/trips', ['trips-limit', 'create', 'start']],
    ['PATCH', '/api/trips/abc', ['trips-limit', 'create', 'finish']],
    ['GET', '/api/trips', ['trips-limit', 'view-own', 'list']],
    ['GET', '/api/trips/abc', ['trips-limit', 'view-own', 'get']],
    ['POST', '/api/trips/abc/detections', ['detections-limit', 'create', 'addDetections']],
  ])(
    '%s %s goes through the limit, then the permission, then the controller',
    async (method, path, expected) => {
      const { app, calls } = setup();

      expect(await send(app, method, path)).toBe(204);
      expect(calls).toEqual(expected);
    },
  );

  it('has no route to change or delete a detection', async () => {
    const { app } = setup();

    expect(await send(app, 'DELETE', '/api/trips/abc')).toBe(404);
    expect(await send(app, 'PATCH', '/api/trips/abc/detections')).toBe(404);
    expect(await send(app, 'PUT', '/api/trips/abc/detections/d1')).toBe(404);
  });
});

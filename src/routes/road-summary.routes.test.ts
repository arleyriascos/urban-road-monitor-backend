import type { AddressInfo } from 'node:net';
import express, { type Request, type RequestHandler, type Response } from 'express';
import { describe, expect, it } from 'vitest';
import { createRoadSummaryRouter } from './road-summary.routes.js';

function setup() {
  const calls: string[] = [];
  const mark: RequestHandler = (_req, _res, next) => {
    calls.push('limit');
    next();
  };
  const handler = (name: string) => async (req: Request, res: Response) => {
    calls.push(`${name}:${req.params.id}`);
    res.status(204).end();
  };
  const app = express();
  app.use(
    '/api',
    createRoadSummaryRouter({ segment: handler('segment'), road: handler('road') }, mark),
  );
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

describe('createRoadSummaryRouter', () => {
  it.each([
    ['/api/road-segments/42/summary', ['limit', 'segment:42']],
    ['/api/roads/7/summary', ['limit', 'road:7']],
  ])('GET %s goes through the limit and then the controller', async (path, expected) => {
    const { app, calls } = setup();
    expect(await send(app, 'GET', path)).toBe(204);
    expect(calls).toEqual(expected);
  });

  it('only reads: nothing else is allowed', async () => {
    const { app } = setup();
    expect(await send(app, 'POST', '/api/roads/7/summary')).toBe(404);
    expect(await send(app, 'DELETE', '/api/road-segments/42/summary')).toBe(404);
    expect(await send(app, 'GET', '/api/roads/7')).toBe(404);
  });
});

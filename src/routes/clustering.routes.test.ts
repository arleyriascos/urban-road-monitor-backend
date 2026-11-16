import type { AddressInfo } from 'node:net';
import express, { type Request, type RequestHandler, type Response } from 'express';
import { describe, expect, it } from 'vitest';
import { createClusteringRouter } from './clustering.routes.js';

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
  const app = express();
  app.use(
    '/api',
    createClusteringRouter(
      { start: handler('start'), list: handler('list') },
      mark('limit'),
      mark('permission'),
    ),
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

describe('createClusteringRouter', () => {
  it.each([
    ['POST', '/api/clustering/runs', ['limit', 'permission', 'start']],
    ['GET', '/api/clustering/runs', ['limit', 'permission', 'list']],
  ])(
    '%s %s goes through the limit, then the permission, then the controller',
    async (method, path, expected) => {
      const { app, calls } = setup();
      expect(await send(app, method, path)).toBe(204);
      expect(calls).toEqual(expected);
    },
  );

  it('has no route to change or delete a run', async () => {
    const { app } = setup();
    expect(await send(app, 'DELETE', '/api/clustering/runs')).toBe(404);
    expect(await send(app, 'PATCH', '/api/clustering/runs/1')).toBe(404);
  });
});

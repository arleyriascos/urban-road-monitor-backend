import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error.js';
import { errorHandler } from '../middlewares/error-handler.js';
import { ClusteringController } from './clustering.controller.js';

function setup() {
  const admin = {
    requestRun: vi.fn(),
    overview: vi.fn(async () => ({
      status: { running: false, nextRunAt: null, failuresInARow: 0, pendingDetections: 0 },
      runs: [],
    })),
  };
  const controller = new ClusteringController(admin as never);
  const app: Express = express();
  app.use((_req, res, next) => {
    res.locals.auth = { userId: 'admin-1', email: 'a@b.c' };
    next();
  });
  app.post('/runs', controller.start);
  app.get('/runs', controller.list);
  app.use(errorHandler);
  return { app, admin };
}

async function call(app: Express, method: string, path: string) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://localhost:${port}${path}`, { method });
    return {
      status: response.status,
      body: (await response.json()) as { status?: string; error?: { code: string } },
      headers: response.headers,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('ClusteringController', () => {
  it('answers 202 and starts a run on behalf of the signed-in person', async () => {
    const { app, admin } = setup();
    const { status, body, headers } = await call(app, 'POST', '/runs');
    expect(status).toBe(202);
    expect(body.status).toBe('started');
    expect(headers.get('cache-control')).toBe('no-store');
    expect(admin.requestRun).toHaveBeenCalledWith('admin-1');
  });

  it('passes on the refusal of the service (a run is already going on)', async () => {
    const { app, admin } = setup();
    admin.requestRun.mockImplementation(() => {
      throw new AppError(409, 'RUN_IN_PROGRESS', 'A consolidation is already running');
    });
    const { status, body } = await call(app, 'POST', '/runs');
    expect(status).toBe(409);
    expect(body.error?.code).toBe('RUN_IN_PROGRESS');
  });

  it('lists the runs, ten by default', async () => {
    const { app, admin } = setup();
    const { status, body } = await call(app, 'GET', '/runs');
    expect(status).toBe(200);
    expect(body).toHaveProperty('status.pendingDetections', 0);
    expect(admin.overview).toHaveBeenCalledWith(10);
  });

  it('reads the limit from the query and refuses a wrong one', async () => {
    const { app, admin } = setup();
    expect((await call(app, 'GET', '/runs?limit=3')).status).toBe(200);
    expect(admin.overview).toHaveBeenLastCalledWith(3);
    expect((await call(app, 'GET', '/runs?limit=500')).status).toBe(400);
    expect((await call(app, 'GET', '/runs?limit=abc')).status).toBe(400);
    expect((await call(app, 'GET', '/runs?other=1')).status).toBe(400);
  });
});

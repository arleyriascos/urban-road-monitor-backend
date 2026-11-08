import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { AppError } from '../errors/app-error.js';
import { errorHandler } from '../middlewares/error-handler.js';
import { createAuthRouter } from '../routes/auth.routes.js';
import type { GoogleLoginResult } from '../services/google-login.service.js';
import { AuthController } from './auth.controller.js';

const EXPIRES = new Date('2026-11-17T12:00:00.000Z');

const result: GoogleLoginResult = {
  token: 'T'.repeat(43),
  expiresAt: EXPIRES,
  user: {
    id: '5f0b3c2e-0000-4000-8000-000000000001',
    email: 'ana@example.com',
    fullName: 'Ana Pérez',
    avatarUrl: null,
    roles: ['usuario'],
  },
};

type Login = (credential: string, request?: object) => Promise<GoogleLoginResult>;

function appWith(login: Login): Express {
  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    createAuthRouter(new AuthController({ login }), (_req, _res, next) => next()),
  );
  app.use(errorHandler);
  return app;
}

async function post(
  app: Express,
  payload: string | object,
  headers: Record<string, string> = {},
  path = '/api/auth/google',
) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://localhost:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });
    return { response, json: (await response.json()) as Record<string, unknown> };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/auth/google', () => {
  it('answers the session and the person, and tells the browser not to keep it', async () => {
    const login = vi.fn<Login>(async () => result);
    const { response, json } = await post(appWith(login), { credential: 'a.b.c' });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(json).toEqual({
      token: 'T'.repeat(43),
      expiresAt: '2026-11-17T12:00:00.000Z',
      user: result.user,
    });
  });

  it('gives the service the token, the user agent and the address of the client', async () => {
    const login = vi.fn<Login>(async () => result);
    await post(
      appWith(login),
      { credential: 'a.b.c' },
      { 'user-agent': 'Chrome en Android', 'true-client-ip': '203.0.113.77' },
    );

    expect(login).toHaveBeenCalledWith('a.b.c', {
      userAgent: 'Chrome en Android',
      ip: '203.0.113.77',
    });
  });

  it('ignores the other fields the Google button hands the frontend', async () => {
    const login = vi.fn<Login>(async () => result);
    const { response } = await post(appWith(login), {
      credential: 'a.b.c',
      select_by: 'btn',
      clientId: 'x.apps.googleusercontent.com',
    });

    expect(response.status).toBe(200);
    expect(login.mock.calls[0]?.[0]).toBe('a.b.c');
  });

  it.each([
    ['no credential', {}, 'credential'],
    ['an empty credential', { credential: '' }, 'credential'],
    ['a credential that is not a text', { credential: 12345 }, 'credential'],
    ['a credential of 4097 characters', { credential: 'x'.repeat(4097) }, 'credential'],
    ['a body that is not an object', [], 'body'],
  ])(
    'answers 400 INVALID_REQUEST for %s and never calls the service',
    async (_n, payload, field) => {
      const login = vi.fn<Login>(async () => result);
      const { response, json } = await post(appWith(login), payload);

      expect(response.status).toBe(400);
      expect(json.error).toMatchObject({ code: 'INVALID_REQUEST' });
      expect(String((json.error as { message: string }).message)).toContain(field);
      expect(login).not.toHaveBeenCalled();
    },
  );

  it('accepts a credential of exactly 4096 characters', async () => {
    const login = vi.fn<Login>(async () => result);
    const { response } = await post(appWith(login), { credential: 'x'.repeat(4096) });
    expect(response.status).toBe(200);
  });

  it('answers 400 INVALID_JSON to a body that is not JSON', async () => {
    const { response, json } = await post(appWith(vi.fn<Login>()), '{not json');

    expect(response.status).toBe(400);
    expect(json.error).toMatchObject({ code: 'INVALID_JSON' });
  });

  it.each([
    [401, 'INVALID_GOOGLE_TOKEN'],
    [403, 'ACCOUNT_DISABLED'],
    [503, 'AUTH_PROVIDER_UNAVAILABLE'],
    [503, 'AUTH_NOT_CONFIGURED'],
    [503, 'DATABASE_UNAVAILABLE'],
  ])('passes the %i %s of the service on as it is', async (status, code) => {
    const login = vi.fn<Login>(async () => {
      throw new AppError(status, code, 'a message');
    });
    const { response, json } = await post(appWith(login), { credential: 'a.b.c' });

    expect(response.status).toBe(status);
    expect(json.error).toEqual({ code, message: 'a message' });
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

describe('POST /api/auth/google in the whole application', () => {
  it('is mounted and answers 503 AUTH_NOT_CONFIGURED while GOOGLE_CLIENT_ID is not set', async () => {
    const { response, json } = await post(createApp(), { credential: 'a.b.c' });

    expect(response.status).toBe(503);
    expect(json.error).toMatchObject({ code: 'AUTH_NOT_CONFIGURED' });
  });

  it('is listed in the root of the API', async () => {
    const server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const body = (await (await fetch(`http://localhost:${port}/`)).json()) as {
        endpoints: string[];
      };
      expect(body.endpoints).toContain('POST /api/auth/google');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('answers 429 from the eleventh attempt of the same address in a minute', async () => {
    const app = createApp();
    const statuses: number[] = [];
    let last: Awaited<ReturnType<typeof post>> | undefined;
    for (let attempt = 1; attempt <= 11; attempt += 1) {
      last = await post(app, { credential: 'a.b.c' }, { 'true-client-ip': '198.51.100.20' });
      statuses.push(last.response.status);
    }

    expect(statuses.slice(0, 10).every((status) => status === 503)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(last?.json.error).toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many sign-in attempts: the limit is 10 per minute',
    });
    expect(Number(last?.response.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('does not share the allowance between two addresses', async () => {
    const app = createApp();
    for (let attempt = 1; attempt <= 11; attempt += 1) {
      await post(app, { credential: 'a.b.c' }, { 'true-client-ip': '198.51.100.30' });
    }
    const other = await post(app, { credential: 'a.b.c' }, { 'true-client-ip': '198.51.100.31' });

    expect(other.response.status).toBe(503);
  });
});

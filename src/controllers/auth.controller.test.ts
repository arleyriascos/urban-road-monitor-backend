import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { AppError } from '../errors/app-error.js';
import { errorHandler } from '../middlewares/error-handler.js';
import { requireSession } from '../middlewares/require-session.js';
import type { AccountProfile } from '../repositories/account.repository.js';
import { createAuthRouter } from '../routes/auth.routes.js';
import type { AccountService } from '../services/account.service.js';
import type { GoogleLoginResult } from '../services/google-login.service.js';
import type { AuthContext, SessionService } from '../services/session.service.js';
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

describe('GET /api/auth/me', () => {
  type Profile = AccountService['profile'];
  type Authenticate = SessionService['authenticate'];

  const TOKEN = 'T'.repeat(43);
  const session: AuthContext = {
    sessionId: 'session-1',
    userId: '5f0b3c2e-0000-4000-8000-000000000001',
    email: 'ana@example.com',
    fullName: 'Ana Pérez',
  };
  const profile: AccountProfile = {
    id: session.userId,
    email: 'ana@example.com',
    fullName: 'Ana Pérez',
    avatarUrl: 'https://lh3.example.com/a/photo=s96-c',
    roles: ['colaborador', 'usuario'],
    permissions: ['detections.create', 'trips.view_own'],
    hasPassword: false,
    emailVerified: true,
  };

  /** The real session check with a service that answers `authenticated`, and a fake profile. */
  function appWithMe(profileOf: Profile, authenticated: AuthContext | null = session): Express {
    const authenticate = vi.fn<Authenticate>(async () => authenticated);
    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      createAuthRouter(
        new AuthController({ login: vi.fn<Login>() }, { profile: profileOf }),
        (_req, _res, next) => next(),
        requireSession({ authenticate }),
      ),
    );
    app.use(errorHandler);
    return app;
  }

  async function getMe(app: Express, headers: Record<string, string> = {}) {
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const response = await fetch(`http://localhost:${port}/api/auth/me`, { headers });
      return { response, json: (await response.json()) as Record<string, unknown> };
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  const bearer = { authorization: `Bearer ${TOKEN}` };

  it('answers the person of the session with their roles and permissions, and no cache', async () => {
    const { response, json } = await getMe(appWithMe(vi.fn<Profile>(async () => profile)), bearer);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(json).toEqual({ user: profile });
  });

  it('answers the same fields as the sign-in plus permissions and the state of the account, and nothing about the session', async () => {
    const { json } = await getMe(appWithMe(vi.fn<Profile>(async () => profile)), bearer);

    expect(Object.keys(json)).toEqual(['user']);
    expect(Object.keys(json.user as object).sort()).toEqual(
      [...Object.keys(result.user), 'permissions', 'hasPassword', 'emailVerified'].sort(),
    );
  });

  it('asks for the person of the session, found by the session and not by the request', async () => {
    const profileOf = vi.fn<Profile>(async () => profile);
    await getMe(appWithMe(profileOf), bearer);

    expect(profileOf).toHaveBeenCalledTimes(1);
    expect(profileOf).toHaveBeenCalledWith(session.userId);
  });

  it('answers the usual 401 without a session and never asks for the profile', async () => {
    const profileOf = vi.fn<Profile>(async () => profile);
    const { response, json } = await getMe(appWithMe(profileOf, null), bearer);

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer realm="session"');
    expect(json).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'A valid session is required' },
    });
    expect(profileOf).not.toHaveBeenCalled();
  });

  it('answers the usual 401 when the account is gone after the session was checked', async () => {
    const { response, json } = await getMe(appWithMe(vi.fn<Profile>(async () => null)), bearer);

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer realm="session"');
    expect(json.error).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('answers 503, not 401, when the database does not answer, so the frontend keeps the session', async () => {
    const profileOf = vi.fn<Profile>(async () => {
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not available right now');
    });
    const { response, json } = await getMe(appWithMe(profileOf), bearer);

    expect(response.status).toBe(503);
    expect(json.error).toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
  });
});

describe('GET /api/auth/me in the whole application', () => {
  it('is mounted and answers 401 without a session', async () => {
    const server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const response = await fetch(`http://localhost:${port}/api/auth/me`);
      expect(response.status).toBe(401);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'UNAUTHORIZED',
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('is listed in the root of the API', async () => {
    const server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const body = (await (await fetch(`http://localhost:${port}/`)).json()) as {
        endpoints: string[];
      };
      expect(body.endpoints).toContain('GET /api/auth/me');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('POST /api/auth/logout', () => {
  type Logout = SessionService['logout'];
  type Authenticate = SessionService['authenticate'];

  const TOKEN = 'T'.repeat(43);
  const session: AuthContext = {
    sessionId: 'session-1',
    userId: '5f0b3c2e-0000-4000-8000-000000000001',
    email: 'ana@example.com',
    fullName: 'Ana Pérez',
  };

  function appWithLogout(logout: Logout, authenticated: AuthContext | null = session): Express {
    const authenticate = vi.fn<Authenticate>(async () => authenticated);
    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      createAuthRouter(
        new AuthController({ login: vi.fn<Login>() }, { profile: vi.fn() }, { logout }),
        (_req, _res, next) => next(),
        requireSession({ authenticate }),
      ),
    );
    app.use(errorHandler);
    return app;
  }

  async function postLogout(app: Express, headers: Record<string, string> = {}) {
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const response = await fetch(`http://localhost:${port}/api/auth/logout`, {
        method: 'POST',
        headers,
      });
      return { response, text: await response.text() };
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  const bearer = { authorization: `Bearer ${TOKEN}` };

  it('closes the session and answers 204 with no body and no cache', async () => {
    const { response, text } = await postLogout(
      appWithLogout(vi.fn<Logout>(async () => true)),
      bearer,
    );

    expect(response.status).toBe(204);
    expect(text).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('closes only the session of the request, and passes the user agent and the address', async () => {
    const logout = vi.fn<Logout>(async () => true);
    await postLogout(appWithLogout(logout), {
      ...bearer,
      'user-agent': 'Chrome en Android',
      'true-client-ip': '203.0.113.77',
    });

    expect(logout).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledWith(
      { sessionId: 'session-1', userId: session.userId },
      { userAgent: 'Chrome en Android', ip: '203.0.113.77' },
    );
  });

  it('does not give the service the email or the name of the person', async () => {
    const logout = vi.fn<Logout>(async () => true);
    await postLogout(appWithLogout(logout), bearer);

    expect(JSON.stringify(logout.mock.calls)).not.toContain('ana@example.com');
  });

  it('answers the usual 401 without a session and closes nothing', async () => {
    const logout = vi.fn<Logout>(async () => true);
    const { response, text } = await postLogout(appWithLogout(logout, null), bearer);

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer realm="session"');
    expect(JSON.parse(text).error.code).toBe('UNAUTHORIZED');
    expect(logout).not.toHaveBeenCalled();
  });

  it('answers the usual 401 when the session stopped working a moment before', async () => {
    const { response, text } = await postLogout(
      appWithLogout(vi.fn<Logout>(async () => false)),
      bearer,
    );

    expect(response.status).toBe(401);
    expect(JSON.parse(text).error.code).toBe('UNAUTHORIZED');
  });

  it('answers 503 when the database does not answer, and the frontend may try again', async () => {
    const logout = vi.fn<Logout>(async () => {
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not available right now');
    });
    const { response, text } = await postLogout(appWithLogout(logout), bearer);

    expect(response.status).toBe(503);
    expect(JSON.parse(text).error.code).toBe('DATABASE_UNAVAILABLE');
  });
});

describe('POST /api/auth/logout in the whole application', () => {
  it('is mounted and answers 401 without a session', async () => {
    const server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const response = await fetch(`http://localhost:${port}/api/auth/logout`, {
        method: 'POST',
      });
      expect(response.status).toBe(401);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('is listed in the root of the API', async () => {
    const server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const body = (await (await fetch(`http://localhost:${port}/`)).json()) as {
        endpoints: string[];
      };
      expect(body.endpoints).toContain('POST /api/auth/logout');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

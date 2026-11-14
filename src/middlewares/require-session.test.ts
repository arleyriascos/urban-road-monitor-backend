import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { AppError } from '../errors/app-error.js';
import type { AuthContext, SessionService } from '../services/session.service.js';
import { errorHandler } from './error-handler.js';
import { authenticateRequest, getAuth, requireSession } from './require-session.js';

type Authenticate = SessionService['authenticate'];

const TOKEN = 'T'.repeat(43);
const person: AuthContext = {
  sessionId: 'session-1',
  userId: 'user-1',
  email: 'ana@example.com',
  fullName: 'Ana Pérez',
};

function createApp(authenticate: Mock<Authenticate>): Express {
  const app = express();
  app.get('/public', (_req, res) => {
    res.status(200).json({ public: true });
  });
  app.get('/private', requireSession({ authenticate }), (_req, res) => {
    res.status(200).json({ email: getAuth(res).email });
  });
  app.use(errorHandler);
  return app;
}

async function get(app: Express, path: string, headers: Record<string, string> = {}) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://localhost:${port}${path}`, { headers });
    return { response, text: await response.text() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requireSession', () => {
  it('lets a valid session through and leaves the person in res.locals', async () => {
    const authenticate = vi.fn<Authenticate>(async () => person);
    const { response, text } = await get(createApp(authenticate), '/private', {
      authorization: `Bearer ${TOKEN}`,
      'user-agent': 'Chrome en Android',
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ email: 'ana@example.com' });
    expect(authenticate).toHaveBeenCalledWith(TOKEN, {
      userAgent: 'Chrome en Android',
      ip: expect.any(String),
    });
  });

  it('accepts the scheme name in any case', async () => {
    const { response } = await get(createApp(vi.fn<Authenticate>(async () => person)), '/private', {
      authorization: `bearer ${TOKEN}`,
    });
    expect(response.status).toBe(200);
  });

  it('takes the client address from True-Client-IP, as the route limit does', async () => {
    const authenticate = vi.fn<Authenticate>(async () => person);
    await get(createApp(authenticate), '/private', {
      authorization: `Bearer ${TOKEN}`,
      'true-client-ip': '203.0.113.77',
    });
    expect(authenticate).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({ ip: '203.0.113.77' }),
    );
  });

  describe('answers one and the same 401', () => {
    const cases: [string, Record<string, string>, AuthContext | null][] = [
      ['no header', {}, null],
      ['another scheme', { authorization: `Basic ${TOKEN}` }, null],
      ['the identifier without the scheme', { authorization: TOKEN }, null],
      ['an empty Bearer value', { authorization: 'Bearer ' }, null],
      ['a session the service does not accept', { authorization: `Bearer ${TOKEN}` }, null],
    ];

    it.each(cases)('for %s', async (_case, headers, result) => {
      const { response, text } = await get(
        createApp(vi.fn<Authenticate>(async () => result)),
        '/private',
        headers,
      );
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer realm="session"');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(JSON.parse(text)).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'A valid session is required' },
      });
    });

    it('without asking the service when there is no identifier', async () => {
      const authenticate = vi.fn<Authenticate>(async () => person);
      await get(createApp(authenticate), '/private');
      await get(createApp(authenticate), '/private', { authorization: 'Basic abc' });
      expect(authenticate).not.toHaveBeenCalled();
    });
  });

  it('answers 503, not 401, when the database does not answer', async () => {
    const authenticate = vi.fn<Authenticate>(async () => {
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not available right now');
    });
    const { response, text } = await get(createApp(authenticate), '/private', {
      authorization: `Bearer ${TOKEN}`,
    });
    expect(response.status).toBe(503);
    expect(JSON.parse(text).error.code).toBe('DATABASE_UNAVAILABLE');
  });

  it('never reads the Authorization header on a public route', async () => {
    const authenticate = vi.fn<Authenticate>(async () => null);
    const { response, text } = await get(createApp(authenticate), '/public', {
      authorization: 'Bearer something broken',
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ public: true });
    expect(authenticate).not.toHaveBeenCalled();
  });
});

describe('getAuth', () => {
  it('fails loudly on a route that does not use requireSession', () => {
    const res = { locals: {} } as unknown as Parameters<typeof getAuth>[0];
    expect(() => getAuth(res)).toThrow('requireSession');
  });
});

describe('authenticateRequest', () => {
  /** A route that uses the function by hand and answers by itself when the session is good. */
  function appWith(authenticate: Mock<Authenticate>): Express {
    const app = express();
    app.get('/by-hand', async (req, res) => {
      if (await authenticateRequest({ authenticate }, req, res)) {
        res.status(200).json({ email: getAuth(res).email });
      }
    });
    app.use(errorHandler);
    return app;
  }

  it('returns true and leaves the person in res.locals when the session works', async () => {
    const { response, text } = await get(
      appWith(vi.fn<Authenticate>(async () => person)),
      '/by-hand',
      { authorization: `Bearer ${TOKEN}` },
    );
    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ email: 'ana@example.com' });
  });

  it('returns false after answering the 401 itself, so the route answers nothing else', async () => {
    const { response, text } = await get(
      appWith(vi.fn<Authenticate>(async () => null)),
      '/by-hand',
      { authorization: `Bearer ${TOKEN}` },
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer realm="session"');
    expect(JSON.parse(text).error.code).toBe('UNAUTHORIZED');
  });

  it('throws the 503 of the service instead of answering 401', async () => {
    const authenticate = vi.fn<Authenticate>(async () => {
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not available right now');
    });
    const { response } = await get(appWith(authenticate), '/by-hand', {
      authorization: `Bearer ${TOKEN}`,
    });
    expect(response.status).toBe(503);
  });
});

import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { AppError } from '../errors/app-error.js';
import type { AccountService } from '../services/account.service.js';
import type { AuthContext, SessionService } from '../services/session.service.js';
import { errorHandler } from './error-handler.js';
import { requirePermission } from './require-permission.js';
import { getAuth } from './require-session.js';

type Authenticate = SessionService['authenticate'];
type HasPermission = AccountService['hasPermission'];

const TOKEN = 'T'.repeat(43);
const person: AuthContext = {
  sessionId: 'session-1',
  userId: 'user-1',
  email: 'ana@example.com',
  fullName: 'Ana Pérez',
};

/** A test route that needs the permission, and a public one beside it. */
function createApp(authenticate: Mock<Authenticate>, hasPermission: Mock<HasPermission>): Express {
  const app = express();
  app.get('/public', (_req, res) => {
    res.status(200).json({ public: true });
  });
  app.get(
    '/protected',
    requirePermission('detections.create', {
      sessions: { authenticate },
      accounts: { hasPermission },
    }),
    (_req, res) => {
      res.status(200).json({ email: getAuth(res).email });
    },
  );
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

const bearer = { authorization: `Bearer ${TOKEN}` };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requirePermission', () => {
  it('lets a person with the permission through and leaves them in res.locals', async () => {
    const authenticate = vi.fn<Authenticate>(async () => person);
    const hasPermission = vi.fn<HasPermission>(async () => true);

    const { response, text } = await get(
      createApp(authenticate, hasPermission),
      '/protected',
      bearer,
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ email: 'ana@example.com' });
  });

  it('asks about the person of the session and the code of the route, once', async () => {
    const authenticate = vi.fn<Authenticate>(async () => person);
    const hasPermission = vi.fn<HasPermission>(async () => true);

    await get(createApp(authenticate, hasPermission), '/protected', bearer);

    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(hasPermission).toHaveBeenCalledTimes(1);
    expect(hasPermission).toHaveBeenCalledWith('user-1', 'detections.create');
  });

  it('answers 403 FORBIDDEN to a person without the permission, and the route never runs', async () => {
    const authenticate = vi.fn<Authenticate>(async () => person);
    const hasPermission = vi.fn<HasPermission>(async () => false);

    const { response, text } = await get(
      createApp(authenticate, hasPermission),
      '/protected',
      bearer,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('www-authenticate')).toBeNull();
    expect(JSON.parse(text)).toEqual({
      error: { code: 'FORBIDDEN', message: 'You do not have permission to do this' },
    });
  });

  it('does not tell which permission was missing', async () => {
    const { text } = await get(
      createApp(
        vi.fn<Authenticate>(async () => person),
        vi.fn<HasPermission>(async () => false),
      ),
      '/protected',
      bearer,
    );
    expect(text).not.toContain('detections');
  });

  describe('answers the same 401 as requireSession, and never asks about the permission', () => {
    const cases: [string, Record<string, string>, AuthContext | null][] = [
      ['no header', {}, null],
      ['another scheme', { authorization: `Basic ${TOKEN}` }, null],
      ['a session the service does not accept', bearer, null],
    ];

    it.each(cases)('for %s', async (_case, headers, result) => {
      const hasPermission = vi.fn<HasPermission>(async () => true);
      const { response, text } = await get(
        createApp(
          vi.fn<Authenticate>(async () => result),
          hasPermission,
        ),
        '/protected',
        headers,
      );

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer realm="session"');
      expect(JSON.parse(text)).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'A valid session is required' },
      });
      expect(hasPermission).not.toHaveBeenCalled();
    });
  });

  it('answers 503, not 401, when the database fails while checking the session', async () => {
    const authenticate = vi.fn<Authenticate>(async () => {
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not available right now');
    });
    const { response } = await get(
      createApp(
        authenticate,
        vi.fn<HasPermission>(async () => true),
      ),
      '/protected',
      bearer,
    );
    expect(response.status).toBe(503);
  });

  it('answers 503, not 403, when the database fails while checking the permission', async () => {
    const hasPermission = vi.fn<HasPermission>(async () => {
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not available right now');
    });
    const { response, text } = await get(
      createApp(
        vi.fn<Authenticate>(async () => person),
        hasPermission,
      ),
      '/protected',
      bearer,
    );

    expect(response.status).toBe(503);
    expect(JSON.parse(text).error.code).toBe('DATABASE_UNAVAILABLE');
  });

  it('never reads the Authorization header on a public route', async () => {
    const authenticate = vi.fn<Authenticate>(async () => null);
    const hasPermission = vi.fn<HasPermission>(async () => false);

    const { response } = await get(createApp(authenticate, hasPermission), '/public', {
      authorization: 'Bearer something broken',
    });

    expect(response.status).toBe(200);
    expect(authenticate).not.toHaveBeenCalled();
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it.each([
    'detections.create',
    'potholes.report_repair',
    'routes.view_history',
    'ai_models.manage',
    'users.manage',
  ])('accepts the code %s', (code) => {
    expect(() => requirePermission(code)).not.toThrow();
  });

  it.each([
    '',
    'detections',
    'detections.',
    '.create',
    'Detections.create',
    'detections.Create',
    ' detections.create',
    'detections.create ',
    'detections.create.now',
    "detections.create'; DROP TABLE users;--",
    'detections-create',
  ])('refuses to build a route with the code "%s"', (code) => {
    expect(() => requirePermission(code)).toThrow('not a permission code');
  });
});

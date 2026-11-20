import type { AddressInfo } from 'node:net';
import express, { type Express, type RequestHandler } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error.js';
import { errorHandler } from '../middlewares/error-handler.js';
import { createRateLimit } from '../middlewares/rate-limit.js';
import { requireSession } from '../middlewares/require-session.js';
import { createAuthRouter } from '../routes/auth.routes.js';
import type { PasswordLoginResult } from '../services/password-auth.service.js';
import type { AuthContext } from '../services/session.service.js';
import { AuthController } from './auth.controller.js';
import { PasswordAuthController } from './password-auth.controller.js';

const EXPIRES = new Date('2026-11-17T12:00:00.000Z');
const result: PasswordLoginResult = {
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
const session: AuthContext = {
  sessionId: 'session-1',
  userId: result.user.id,
  email: 'ana@example.com',
  fullName: 'Ana Pérez',
};

const register = vi.fn();
const login = vi.fn();
const changePassword = vi.fn();
const pass: RequestHandler = (_req, _res, next) => next();

function appWith(
  limits: Partial<Record<'register' | 'login' | 'loginByEmail' | 'change', RequestHandler>> = {},
  authenticated: AuthContext | null = session,
): Express {
  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    createAuthRouter(
      new AuthController(),
      pass,
      requireSession({ authenticate: vi.fn(async () => authenticated) }),
      new PasswordAuthController({ register, login, changePassword }),
      { register: pass, login: pass, loginByEmail: pass, change: pass, ...limits },
    ),
  );
  app.use(errorHandler);
  return app;
}

async function post(
  app: Express,
  path: string,
  payload: string | object,
  headers: Record<string, string> = {},
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
  vi.resetAllMocks();
});

const PASSWORD = 'una contraseña larga';
const bearer = { authorization: `Bearer ${'T'.repeat(43)}`, 'user-agent': 'test-agent' };

describe('POST /api/auth/register', () => {
  it('answers 201 with the session and the person, and tells the browser not to keep it', async () => {
    register.mockResolvedValue(result);
    const { response, json } = await post(appWith(), '/api/auth/register', {
      name: ' Ana Pérez ',
      email: ' Ana@Example.com ',
      password: PASSWORD,
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(json).toEqual({
      token: 'T'.repeat(43),
      expiresAt: EXPIRES.toISOString(),
      user: result.user,
    });
    expect(register).toHaveBeenCalledWith(
      { name: 'Ana Pérez', email: 'Ana@Example.com', password: PASSWORD },
      expect.objectContaining({ ip: expect.any(String) }),
    );
  });

  it.each([
    ['no body', {}],
    ['an empty name', { name: '  ', email: 'ana@example.com', password: PASSWORD }],
    [
      'a name of 151 characters',
      { name: 'a'.repeat(151), email: 'ana@example.com', password: PASSWORD },
    ],
    ['an invalid email', { name: 'Ana', email: 'not-an-email', password: PASSWORD }],
    ['a number as the email', { name: 'Ana', email: 5, password: PASSWORD }],
    ['an empty password', { name: 'Ana', email: 'ana@example.com', password: '' }],
    ['a huge password', { name: 'Ana', email: 'ana@example.com', password: 'x'.repeat(2000) }],
  ])('answers 400 for %s, without calling the service', async (_name, payload) => {
    const { response, json } = await post(appWith(), '/api/auth/register', payload);
    expect(response.status).toBe(400);
    expect(json).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    expect(register).not.toHaveBeenCalled();
  });

  it('passes the errors of the service on as they are', async () => {
    register.mockRejectedValue(
      new AppError(409, 'EMAIL_TAKEN', 'An account with that email already exists'),
    );
    const { response, json } = await post(appWith(), '/api/auth/register', {
      name: 'Ana',
      email: 'ana@example.com',
      password: PASSWORD,
    });
    expect(response.status).toBe(409);
    expect(json).toMatchObject({ error: { code: 'EMAIL_TAKEN' } });
  });
});

describe('POST /api/auth/login', () => {
  it('answers 200 with the session and the person, and no cache', async () => {
    login.mockResolvedValue(result);
    const { response, json } = await post(appWith(), '/api/auth/login', {
      email: 'ana@example.com',
      password: PASSWORD,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(json).toMatchObject({ token: 'T'.repeat(43), user: { id: result.user.id } });
    expect(login).toHaveBeenCalledWith(
      { email: 'ana@example.com', password: PASSWORD },
      expect.anything(),
    );
  });

  it.each([
    ['no email', { password: PASSWORD }],
    ['an empty email', { email: '', password: PASSWORD }],
    ['no password', { email: 'ana@example.com' }],
    ['a list as the password', { email: 'ana@example.com', password: ['a'] }],
  ])('answers 400 for %s', async (_name, payload) => {
    const { response } = await post(appWith(), '/api/auth/login', payload);
    expect(response.status).toBe(400);
    expect(login).not.toHaveBeenCalled();
  });

  it('answers the 401 of the service', async () => {
    login.mockRejectedValue(
      new AppError(401, 'INVALID_CREDENTIALS', 'The email or the password is not correct'),
    );
    const { response, json } = await post(appWith(), '/api/auth/login', {
      email: 'ana@example.com',
      password: 'x',
    });
    expect(response.status).toBe(401);
    expect(json).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } });
  });

  it('stops the tenth-and-one attempt for the same email, even from another address', async () => {
    login.mockRejectedValue(new AppError(401, 'INVALID_CREDENTIALS', 'no'));
    const byEmail = createRateLimit({
      limit: 2,
      addressOf: (req) => `email:${String((req.body as { email: string }).email).toLowerCase()}`,
    });
    const app = appWith({ loginByEmail: byEmail });
    const attempt = (email: string) =>
      post(app, '/api/auth/login', { email, password: 'x' }).then((r) => r.response.status);

    expect(await attempt('Ana@example.com')).toBe(401);
    expect(await attempt('ana@example.com')).toBe(401);
    expect(await attempt('ANA@example.com')).toBe(429);
    expect(await attempt('other@example.com')).toBe(401);
  });
});

describe('POST /api/auth/password', () => {
  const body = { currentPassword: PASSWORD, newPassword: 'otra contraseña distinta' };

  it('changes the password of the person of the session and says how many sessions it closed', async () => {
    changePassword.mockResolvedValue(2);
    const { response, json } = await post(appWith(), '/api/auth/password', body, bearer);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(json).toEqual({ otherSessionsClosed: 2 });
    expect(changePassword).toHaveBeenCalledWith(
      { userId: session.userId, sessionId: 'session-1', email: 'ana@example.com' },
      body,
      expect.objectContaining({ userAgent: 'test-agent' }),
    );
  });

  it('answers 401 without a valid session and never reaches the service', async () => {
    const withoutHeader = await post(appWith(), '/api/auth/password', body);
    const withDeadSession = await post(appWith({}, null), '/api/auth/password', body, bearer);
    expect(withoutHeader.response.status).toBe(401);
    expect(withDeadSession.response.status).toBe(401);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('answers 400 for a body without the two passwords', async () => {
    const { response } = await post(appWith(), '/api/auth/password', { newPassword: 'x' }, bearer);
    expect(response.status).toBe(400);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('answers the 403 of a wrong current password', async () => {
    changePassword.mockRejectedValue(new AppError(403, 'INVALID_CURRENT_PASSWORD', 'no'));
    const { response, json } = await post(appWith(), '/api/auth/password', body, bearer);
    expect(response.status).toBe(403);
    expect(json).toMatchObject({ error: { code: 'INVALID_CURRENT_PASSWORD' } });
  });
});

import type { AddressInfo } from 'node:net';
import express, { type Express, type RequestHandler } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error.js';
import { errorHandler } from '../middlewares/error-handler.js';
import { createRateLimit } from '../middlewares/rate-limit.js';
import { requireSession } from '../middlewares/require-session.js';
import { createAuthRouter } from '../routes/auth.routes.js';
import type { AuthContext } from '../services/session.service.js';
import { AuthController } from './auth.controller.js';
import { EmailLinkController } from './email-link.controller.js';

const session: AuthContext = {
  sessionId: 'session-1',
  userId: '5f0b3c2e-0000-4000-8000-000000000001',
  email: 'ana@example.com',
  fullName: 'Ana',
};
const sendVerification = vi.fn();
const verifyEmail = vi.fn();
const requestPasswordReset = vi.fn();
const resetPassword = vi.fn();
const pass: RequestHandler = (_req, _res, next) => next();

function appWith(
  limits: Partial<
    Record<
      'sendByIp' | 'sendByUser' | 'verify' | 'forgotByIp' | 'forgotByEmail' | 'reset',
      RequestHandler
    >
  > = {},
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
      undefined,
      undefined,
      new EmailLinkController({
        sendVerification,
        verifyEmail,
        requestPasswordReset,
        resetPassword,
      }),
      {
        sendByIp: pass,
        sendByUser: pass,
        verify: pass,
        forgotByIp: pass,
        forgotByEmail: pass,
        reset: pass,
        ...limits,
      },
    ),
  );
  app.use(errorHandler);
  return app;
}

async function post(
  app: Express,
  path: string,
  payload: object = {},
  headers: Record<string, string> = {},
) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://localhost:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    return {
      status: response.status,
      headers: response.headers,
      body: (await response.json()) as {
        error: { code: string };
        sent?: boolean;
        verified?: boolean;
      },
    };
  } finally {
    server.close();
  }
}

const auth = { authorization: `Bearer ${'a'.repeat(43)}` };

describe('POST /api/auth/verify-email/send', () => {
  it('sends the link to the person of the session and says so, without caching', async () => {
    sendVerification.mockReset().mockResolvedValue(undefined);

    const answer = await post(appWith(), '/api/auth/verify-email/send', {}, auth);

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ sent: true });
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(sendVerification).toHaveBeenCalledWith(session.userId);
  });

  it('needs a session: without one it answers 401 and sends nothing', async () => {
    sendVerification.mockReset();
    const answer = await post(appWith({}, null), '/api/auth/verify-email/send', {}, auth);
    expect(answer.status).toBe(401);
    expect(sendVerification).not.toHaveBeenCalled();
  });

  it('shows the error of the service as it is', async () => {
    sendVerification.mockReset().mockRejectedValue(new AppError(409, 'ALREADY_VERIFIED', 'done'));
    const answer = await post(appWith(), '/api/auth/verify-email/send', {}, auth);
    expect(answer.status).toBe(409);
    expect(answer.body.error.code).toBe('ALREADY_VERIFIED');
  });

  it('is stopped by the limit of the address before the session is checked, and by the limit of the person after it', async () => {
    sendVerification.mockReset();
    const stop: RequestHandler = (_req, res) =>
      void res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS' } });

    expect(
      (await post(appWith({ sendByIp: stop }, null), '/api/auth/verify-email/send')).status,
    ).toBe(429);
    expect(
      (await post(appWith({ sendByUser: stop }, null), '/api/auth/verify-email/send', {}, auth))
        .status,
    ).toBe(401);
    expect(
      (await post(appWith({ sendByUser: stop }), '/api/auth/verify-email/send', {}, auth)).status,
    ).toBe(429);
    expect(sendVerification).not.toHaveBeenCalled();
  });

  it('really limits one person to 3 messages, whatever the address', async () => {
    sendVerification.mockReset().mockResolvedValue(undefined);
    const app = appWith({
      sendByUser: createRateLimit({
        limit: 3,
        windowMs: 600_000,
        addressOf: (req) => `user:${(req.res?.locals.auth as AuthContext).userId}`,
      }),
    });
    const statuses = [];
    for (let i = 0; i < 4; i++)
      statuses.push((await post(app, '/api/auth/verify-email/send', {}, auth)).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});

describe('POST /api/auth/verify-email', () => {
  it('uses the token of the link without a session', async () => {
    verifyEmail.mockReset().mockResolvedValue(undefined);

    const answer = await post(appWith({}, null), '/api/auth/verify-email', {
      token: 'x'.repeat(43),
    });

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ verified: true });
    expect(verifyEmail).toHaveBeenCalledWith(
      'x'.repeat(43),
      expect.objectContaining({ ip: expect.any(String) }),
    );
  });

  it.each([
    ['no token', {}],
    ['a token that is not a text', { token: 5 }],
    ['an empty token', { token: '' }],
    ['a huge token', { token: 'a'.repeat(201) }],
  ])('answers 400 for %s and never reaches the service', async (_name, body) => {
    verifyEmail.mockReset();
    const answer = await post(appWith({}, null), '/api/auth/verify-email', body);
    expect(answer.status).toBe(400);
    expect(answer.body.error.code).toBe('INVALID_REQUEST');
    expect(verifyEmail).not.toHaveBeenCalled();
  });

  it('shows the 400 of a link that does not work', async () => {
    verifyEmail.mockReset().mockRejectedValue(new AppError(400, 'INVALID_TOKEN', 'bad link'));
    const answer = await post(appWith({}, null), '/api/auth/verify-email', {
      token: 'x'.repeat(43),
    });
    expect(answer.status).toBe(400);
    expect(answer.body.error.code).toBe('INVALID_TOKEN');
  });
});

describe('POST /api/auth/forgot-password', () => {
  it('always says the same thing, and never asks for a session', async () => {
    requestPasswordReset.mockReset().mockResolvedValue(undefined);

    const answer = await post(appWith({}, null), '/api/auth/forgot-password', {
      email: ' Ana@Example.com ',
    });

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ sent: true });
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(requestPasswordReset).toHaveBeenCalledWith('Ana@Example.com');
  });

  it.each([
    ['no email', {}],
    ['an email that is not a text', { email: 7 }],
    ['an empty email', { email: ' ' }],
    ['a huge email', { email: 'a'.repeat(300) }],
  ])('answers 400 for %s and never reaches the service', async (_name, body) => {
    requestPasswordReset.mockReset();
    const answer = await post(appWith({}, null), '/api/auth/forgot-password', body);
    expect(answer.status).toBe(400);
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it('is stopped by both limits before it reaches the service', async () => {
    requestPasswordReset.mockReset();
    const stop: RequestHandler = (_req, res) =>
      void res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS' } });
    for (const limits of [{ forgotByIp: stop }, { forgotByEmail: stop }]) {
      const answer = await post(appWith(limits, null), '/api/auth/forgot-password', {
        email: 'a@example.com',
      });
      expect(answer.status).toBe(429);
    }
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it('shows the 503 when the e-mail service is not configured', async () => {
    requestPasswordReset
      .mockReset()
      .mockRejectedValue(new AppError(503, 'MAIL_NOT_CONFIGURED', 'off'));
    const answer = await post(appWith({}, null), '/api/auth/forgot-password', {
      email: 'a@example.com',
    });
    expect(answer.status).toBe(503);
    expect(answer.body.error.code).toBe('MAIL_NOT_CONFIGURED');
  });
});

describe('POST /api/auth/reset-password', () => {
  it('chooses the new password with the token, without a session', async () => {
    resetPassword.mockReset().mockResolvedValue(1);

    const answer = await post(appWith({}, null), '/api/auth/reset-password', {
      token: 'x'.repeat(43),
      newPassword: 'una contraseña nueva larga',
    });

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ reset: true });
    expect(resetPassword).toHaveBeenCalledWith(
      'x'.repeat(43),
      'una contraseña nueva larga',
      expect.objectContaining({ ip: expect.any(String) }),
    );
  });

  it.each([
    ['no token', { newPassword: 'abc' }],
    ['no password', { token: 'x'.repeat(43) }],
    ['a password that is not a text', { token: 'x'.repeat(43), newPassword: 5 }],
    ['an empty password', { token: 'x'.repeat(43), newPassword: '' }],
    ['a huge password', { token: 'x'.repeat(43), newPassword: 'a'.repeat(2000) }],
  ])('answers 400 for %s and never reaches the service', async (_name, body) => {
    resetPassword.mockReset();
    const answer = await post(appWith({}, null), '/api/auth/reset-password', body);
    expect(answer.status).toBe(400);
    expect(answer.body.error.code).toBe('INVALID_REQUEST');
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('shows the error of a link that does not work or a password that is refused', async () => {
    resetPassword
      .mockReset()
      .mockRejectedValueOnce(new AppError(400, 'INVALID_TOKEN', 'bad'))
      .mockRejectedValueOnce(
        new AppError(400, 'INVALID_PASSWORD', 'bad', { problem: 'too_short' }),
      );
    const body = { token: 'x'.repeat(43), newPassword: 'abc' };

    expect((await post(appWith({}, null), '/api/auth/reset-password', body)).body.error.code).toBe(
      'INVALID_TOKEN',
    );
    expect((await post(appWith({}, null), '/api/auth/reset-password', body)).body.error.code).toBe(
      'INVALID_PASSWORD',
    );
  });
});

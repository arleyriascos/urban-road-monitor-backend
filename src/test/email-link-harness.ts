import type { AddressInfo } from 'node:net';
import express from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { EmailLinkController } from '../controllers/email-link.controller.js';
import { PasswordAuthController } from '../controllers/password-auth.controller.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Mailer, MailMessage } from '../mail/mailer.js';
import { errorHandler } from '../middlewares/error-handler.js';
import { requireSession } from '../middlewares/require-session.js';
import { AccountRepository } from '../repositories/account.repository.js';
import { AuthLogRepository } from '../repositories/auth-log.repository.js';
import { EmailTokenRepository } from '../repositories/email-token.repository.js';
import { PasswordAccountRepository } from '../repositories/password-account.repository.js';
import { SessionRepository } from '../repositories/session.repository.js';
import { createAuthRouter } from '../routes/auth.routes.js';
import { AccountService } from '../services/account.service.js';
import { EmailLinkService } from '../services/email-link.service.js';
import { PasswordAuthService } from '../services/password-auth.service.js';
import { SessionService } from '../services/session.service.js';

const pass = (_req: unknown, _res: unknown, next: () => void) => next();

export interface HarnessAnswer {
  status: number;
  body: {
    token: string;
    sent?: boolean;
    verified?: boolean;
    user: { id: string; email: string };
    error: { code: string; message: string; details?: { problem?: string } };
  };
}

/**
 * The accounts with a password and the links sent by e-mail, from the HTTP request to the real
 * tables. The mailer is a fake that keeps what it was asked to send, so a test can read the link
 * the way a person would. The limiters are off: they have their own tests.
 */
export async function startEmailLinkApp(db: PrismaClient, mailConfigured = true) {
  const sent: MailMessage[] = [];
  const mailer: Mailer = { send: async (message) => void sent.push(message) };

  const logs = new AuthLogRepository(db);
  const sessions = new SessionService(new SessionRepository(db), logs);
  const passwordService = new PasswordAuthService(
    new PasswordAccountRepository(db),
    sessions,
    logs,
  );
  const links = new EmailLinkService(
    new EmailTokenRepository(db),
    mailConfigured ? { mailer, appUrl: 'https://site.example.com' } : null,
    logs,
  );

  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    createAuthRouter(
      new AuthController(undefined, new AccountService(new AccountRepository(db)), sessions),
      pass,
      requireSession(sessions),
      new PasswordAuthController(passwordService),
      { register: pass, login: pass, loginByEmail: pass, change: pass },
      new EmailLinkController(links),
      { sendByIp: pass, sendByUser: pass, verify: pass },
    ),
  );
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

  async function call(
    path: string,
    body?: unknown,
    token?: string,
    method = 'POST',
  ): Promise<HarnessAnswer> {
    const response = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Chrome en Android',
        'true-client-ip': '203.0.113.77',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    });
    return { status: response.status, body: (await response.json()) as HarnessAnswer['body'] };
  }

  /** The token inside the link of the last message that went out. */
  const lastToken = (): string => {
    const message = sent.at(-1);
    const match = /#token=([A-Za-z0-9_-]{43})/.exec(message?.text ?? '');
    if (!match) throw new Error('No link in the last message');
    return match[1]!;
  };

  return {
    call,
    sent,
    lastToken,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

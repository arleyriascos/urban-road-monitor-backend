import type { AddressInfo } from 'node:net';
import express from 'express';
import { describe, expect, it } from 'vitest';
import {
  passwordRecoveryEmailRateLimit,
  passwordRecoveryIpRateLimit,
  passwordResetRateLimit,
  verificationRateLimit,
  verificationSendIpRateLimit,
  verificationSendUserRateLimit,
} from './rate-limit.js';

async function statuses(
  limiter: express.RequestHandler,
  total: number,
  request: (i: number) => { ip: string; body?: object; locals?: object },
) {
  const app = express();
  app.use(express.json());
  app.post(
    '/x',
    (req, res, next) => {
      Object.assign(res.locals, (req.body as { locals?: object }).locals ?? {});
      next();
    },
    limiter,
    (_req, res) => void res.json({ ok: true }),
  );
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const result: number[] = [];
    for (let i = 0; i < total; i++) {
      const { ip, body } = request(i);
      const response = await fetch(`http://localhost:${port}/x`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'true-client-ip': ip },
        body: JSON.stringify(body ?? {}),
      });
      result.push(response.status);
    }
    return result;
  } finally {
    server.close();
  }
}

describe('the limits of the e-mail links', () => {
  it('lets 10 verification e-mails per address in 10 minutes and stops the 11th', async () => {
    const result = await statuses(verificationSendIpRateLimit, 11, () => ({ ip: '198.51.100.1' }));
    expect(result.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(result[10]).toBe(429);
  });

  it('counts the person and not the address for the verification e-mails: 3 and then stop', async () => {
    const locals = { auth: { userId: 'u1' } };
    const result = await statuses(verificationSendUserRateLimit, 5, (i) => ({
      ip: `198.51.100.${i + 10}`,
      body: { locals },
    }));
    expect(result).toEqual([200, 200, 200, 429, 429]);
  });

  it('lets 10 uses of a verification link per minute and address', async () => {
    const result = await statuses(verificationRateLimit, 11, () => ({ ip: '198.51.100.2' }));
    expect(result[9]).toBe(200);
    expect(result[10]).toBe(429);
  });

  it('lets 5 recovery requests per address in 10 minutes', async () => {
    const result = await statuses(passwordRecoveryIpRateLimit, 6, () => ({ ip: '198.51.100.3' }));
    expect(result).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('lets 3 recovery requests per email in an hour, whatever the address and the capitals, with or without an account', async () => {
    const emails = ['ana@example.com', ' ANA@example.com', 'Ana@Example.com', 'ana@example.com'];
    const result = await statuses(passwordRecoveryEmailRateLimit, 4, (i) => ({
      ip: `198.51.100.${i + 20}`,
      body: { email: emails[i] },
    }));
    expect(result).toEqual([200, 200, 200, 429]);
  });

  it('does not stop a different email', async () => {
    const result = await statuses(passwordRecoveryEmailRateLimit, 3, (i) => ({
      ip: '198.51.100.30',
      body: { email: `otra${i}@example.com` },
    }));
    expect(result).toEqual([200, 200, 200]);
  });

  it('lets 10 uses of a recovery link per minute and address', async () => {
    const result = await statuses(passwordResetRateLimit, 11, () => ({ ip: '198.51.100.4' }));
    expect(result[9]).toBe(200);
    expect(result[10]).toBe(429);
  });
});

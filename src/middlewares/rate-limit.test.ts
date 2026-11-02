import type { AddressInfo } from 'node:net';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { clientAddress, createRateLimit, ROUTE_REQUESTS_PER_MINUTE } from './rate-limit.js';

function clock() {
  let time = 1_000_000;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

async function withApp(options: Parameters<typeof createRateLimit>[0]) {
  const app = express();
  app.post('/routes', createRateLimit(options), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  // Every request comes from the same connection; True-Client-IP is what tells clients apart.
  const ask = (address?: string, extra: Record<string, string> = {}) =>
    fetch(`http://localhost:${port}/routes`, {
      method: 'POST',
      headers: { ...(address === undefined ? {} : { 'true-client-ip': address }), ...extra },
    });
  const close = () => new Promise((resolve) => server.close(resolve));
  return { ask, close };
}

describe('createRateLimit', () => {
  it('lets 30 requests a minute through and answers 429 to the next one', async () => {
    const time = clock();
    const { ask, close } = await withApp({ now: time.now });
    try {
      for (let i = 0; i < ROUTE_REQUESTS_PER_MINUTE; i++) {
        expect((await ask('190.0.0.1')).status).toBe(200);
      }
      time.advance(20_000);
      const blocked = await ask('190.0.0.1');

      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('retry-after')).toBe('40');
      expect(await blocked.json()).toEqual({
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many route requests: the limit is 30 per minute',
          details: { retryAfterS: 40 },
        },
      });
    } finally {
      await close();
    }
  });

  it('counts each address apart', async () => {
    const { ask, close } = await withApp({ limit: 2 });
    try {
      await ask('190.0.0.1');
      await ask('190.0.0.1');
      expect((await ask('190.0.0.1')).status).toBe(429);
      expect((await ask('190.0.0.2')).status).toBe(200);
    } finally {
      await close();
    }
  });

  it('starts counting again after the minute', async () => {
    const time = clock();
    const { ask, close } = await withApp({ limit: 1, now: time.now });
    try {
      await ask('190.0.0.1');
      expect((await ask('190.0.0.1')).status).toBe(429);
      time.advance(60_000);
      expect((await ask('190.0.0.1')).status).toBe(200);
    } finally {
      await close();
    }
  });

  it('keeps memory capped: a new address pushes out the least recently seen one', async () => {
    const { ask, close } = await withApp({ limit: 1, capacity: 2 });
    try {
      await ask('190.0.0.1');
      expect((await ask('190.0.0.1')).status).toBe(429);
      await ask('190.0.0.2');
      await ask('190.0.0.3'); // the cache only has room for two addresses

      expect((await ask('190.0.0.1')).status).toBe(200);
    } finally {
      await close();
    }
  });

  it('ignores X-Forwarded-For, whose proxies cannot be counted reliably on Render', async () => {
    const { ask, close } = await withApp({ limit: 1 });
    try {
      await ask('190.0.0.9', { 'x-forwarded-for': '1.1.1.1' });
      // Same True-Client-IP and another X-Forwarded-For: still the same client, so blocked.
      expect((await ask('190.0.0.9', { 'x-forwarded-for': '2.2.2.2' })).status).toBe(429);
      // Another True-Client-IP with the same X-Forwarded-For: another client, so allowed.
      expect((await ask('190.0.0.10', { 'x-forwarded-for': '2.2.2.2' })).status).toBe(200);
    } finally {
      await close();
    }
  });

  it('without True-Client-IP, counts by the address of the connection', async () => {
    const { ask, close } = await withApp({ limit: 2 });
    try {
      await ask();
      await ask();
      expect((await ask()).status).toBe(429);
      expect((await ask('190.0.0.20')).status).toBe(200);
    } finally {
      await close();
    }
  });
});

describe('clientAddress', () => {
  function request(headers: Record<string, string>, ip = '10.0.0.5') {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return { get: (name: string) => lower[name.toLowerCase()], ip, socket: {} } as never;
  }

  it('uses True-Client-IP when it is a valid address', () => {
    expect(clientAddress(request({ 'True-Client-IP': '190.0.0.1' }))).toBe('190.0.0.1');
    expect(clientAddress(request({ 'True-Client-IP': ' 2800:e2::1 ' }))).toBe('2800:e2::1');
  });

  it.each(['', 'not-an-ip', '190.0.0.1, 10.0.0.1', '999.1.1.1'])(
    'falls back to the connection address when True-Client-IP is %j',
    (value) => {
      expect(clientAddress(request({ 'True-Client-IP': value }))).toBe('10.0.0.5');
    },
  );

  it('uses the connection address without the header', () => {
    expect(clientAddress(request({}))).toBe('10.0.0.5');
  });
});

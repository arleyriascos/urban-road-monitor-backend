import type { AddressInfo } from 'node:net';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { createRateLimit, ROUTE_REQUESTS_PER_MINUTE } from './rate-limit.js';

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
  app.set('trust proxy', 1); // as in app.ts
  app.post('/routes', createRateLimit(options), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const ask = (address: string) =>
    fetch(`http://localhost:${port}/routes`, {
      method: 'POST',
      headers: { 'x-forwarded-for': address },
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

  it('uses the address Render adds, not one a client puts first', async () => {
    const { ask, close } = await withApp({ limit: 1 });
    try {
      // The client invents 1.1.1.1; Render appends the real address at the end.
      await ask('1.1.1.1, 190.0.0.9');
      expect((await ask('2.2.2.2, 190.0.0.9')).status).toBe(429);
    } finally {
      await close();
    }
  });
});

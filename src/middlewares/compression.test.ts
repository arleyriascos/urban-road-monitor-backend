import type { AddressInfo } from 'node:net';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { compressionMiddleware } from './compression.js';

async function get(path: string) {
  const app = express();
  app.use(compressionMiddleware);
  app.get('/big', (_req, res) => {
    res.json({ text: 'road '.repeat(2_000) });
  });
  app.get('/small', (_req, res) => {
    res.json({ ok: true });
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://localhost:${port}${path}`, {
      headers: { 'accept-encoding': 'gzip' },
    });
    return { encoding: response.headers.get('content-encoding'), body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('compressionMiddleware', () => {
  it('compresses large responses with gzip and the client can still read them', async () => {
    const { encoding, body } = await get('/big');
    expect(encoding).toBe('gzip');
    expect((body as { text: string }).text.startsWith('road road')).toBe(true);
  });

  it('does not compress small responses', async () => {
    const { encoding, body } = await get('/small');
    expect(encoding).toBeNull();
    expect(body).toEqual({ ok: true });
  });
});

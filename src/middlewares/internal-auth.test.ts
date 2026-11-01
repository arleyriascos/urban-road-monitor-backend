import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { describe, expect, it } from 'vitest';
import { requireInternalToken } from './internal-auth.js';
import { notFoundHandler } from './not-found.js';

const TOKEN = 'f'.repeat(64);

function createApp(expectedToken: string | undefined): Express {
  const app = express();
  app.use('/internal', requireInternalToken(expectedToken));
  app.get('/internal/graph', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use(notFoundHandler);
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

describe('requireInternalToken', () => {
  it('lets the request through with the right token', async () => {
    const { response, text } = await get(createApp(TOKEN), '/internal/graph', {
      authorization: `Bearer ${TOKEN}`,
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ ok: true });
  });

  it('accepts the scheme name in any case', async () => {
    const { response } = await get(createApp(TOKEN), '/internal/graph', {
      authorization: `bearer ${TOKEN}`,
    });
    expect(response.status).toBe(200);
  });

  it.each([
    ['no header', {}],
    ['a wrong token', { authorization: `Bearer ${'e'.repeat(64)}` }],
    ['a token of another length', { authorization: 'Bearer short' }],
    ['the right token without the Bearer scheme', { authorization: TOKEN }],
    ['another scheme', { authorization: `Basic ${TOKEN}` }],
    ['an empty Bearer value', { authorization: 'Bearer ' }],
  ])('answers 401 with %s', async (_case, headers: Record<string, string>) => {
    const { response, text } = await get(createApp(TOKEN), '/internal/graph', headers);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer realm="internal"');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(text)).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'A valid internal token is required' },
    });
  });

  it('never sends the token back', async () => {
    const { text } = await get(createApp(TOKEN), '/internal/graph', {
      authorization: `Bearer ${TOKEN.slice(0, 40)}`,
    });
    expect(text).not.toContain(TOKEN.slice(0, 40));
  });

  it('answers the same 404 as an unknown route when no token is configured', async () => {
    const app = createApp(undefined);
    const internal = await get(app, '/internal/graph', { authorization: `Bearer ${TOKEN}` });
    expect(internal.response.status).toBe(404);
    expect(JSON.parse(internal.text)).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /internal/graph does not exist' },
    });
  });

  it('asks for the token before revealing that an internal route does not exist', async () => {
    const { response } = await get(createApp(TOKEN), '/internal/unknown');
    expect(response.status).toBe(401);
  });

  it('answers 404 for an unknown internal route with the right token', async () => {
    const { response } = await get(createApp(TOKEN), '/internal/unknown', {
      authorization: `Bearer ${TOKEN}`,
    });
    expect(response.status).toBe(404);
  });
});

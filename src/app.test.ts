import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSON_BODY_LIMIT, createApp } from './app.js';

/** Sends a JSON body whose text is exactly `bytes` long and answers what the API said. */
async function postOfSize(path: string, bytes: number) {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    // {"credential":"xxx"} is 17 characters long plus the filler.
    const filler = 'x'.repeat(bytes - '{"credential":""}'.length);
    const response = await fetch(`http://localhost:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: `{"credential":"${filler}"}`,
    });
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the size limit of a JSON body', () => {
  it('is 100 KB', () => {
    expect(JSON_BODY_LIMIT).toBe('100kb');
  });

  it.each(['/api/auth/google', '/api/routes'])(
    'answers 413 PAYLOAD_TOO_LARGE to a body over the limit at POST %s',
    async (path) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { status, json } = await postOfSize(path, 100 * 1024 + 1);

      expect(status).toBe(413);
      expect(json).toEqual({
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large' },
      });
      expect(consoleError).not.toHaveBeenCalled();
    },
  );

  it('reads a body of exactly 100 KB: the validation of the endpoint decides, not the limit', async () => {
    const { status, json } = await postOfSize('/api/auth/google', 100 * 1024);

    expect(status).toBe(400);
    expect(json.error).toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

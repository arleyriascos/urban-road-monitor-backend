import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BBOX, OVERPASS_ENDPOINTS } from './config.js';
import { loadOverpassData } from './overpass-client.js';

const okBody = JSON.stringify({ elements: [{ type: 'way', id: 1 }] });
const reply = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'overpass-test-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function setup() {
  const fetchImpl = vi.fn<typeof fetch>();
  const sleeps: number[] = [];
  const options = {
    fetchImpl,
    cacheDirectory: directory,
    baseDelayMs: 10,
    maxAttempts: 3,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  };
  return { fetchImpl, sleeps, options };
}

describe('loadOverpassData download', () => {
  it('downloads once and saves the answer on disk', async () => {
    const { fetchImpl, options } = setup();
    fetchImpl.mockResolvedValueOnce(reply(okBody));

    const result = await loadOverpassData(DEFAULT_BBOX, options);

    expect(result.source).toBe('download');
    expect(result.response.elements).toHaveLength(1);
    expect(result.sizeBytes).toBe(Buffer.byteLength(okBody));
    expect(await readFile(result.cacheFile, 'utf8')).toBe(okBody);
    expect(result.cacheFile).toContain('overpass-1.17_-77.32_1.25_-77.24.json');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(OVERPASS_ENDPOINTS[0]);
    expect(init?.method).toBe('POST');
    expect(String(init?.body)).toContain('data=');
  });

  it('does not leave temporary files behind', async () => {
    const { fetchImpl, options } = setup();
    fetchImpl.mockResolvedValueOnce(reply(okBody));
    const result = await loadOverpassData(DEFAULT_BBOX, options);
    await expect(stat(`${result.cacheFile}.tmp`)).rejects.toThrow();
  });
});

describe('loadOverpassData cache', () => {
  it('reads the saved file instead of downloading again', async () => {
    const first = setup();
    first.fetchImpl.mockResolvedValueOnce(reply(okBody));
    await loadOverpassData(DEFAULT_BBOX, first.options);

    const second = setup();
    const result = await loadOverpassData(DEFAULT_BBOX, second.options);

    expect(result.source).toBe('cache');
    expect(second.fetchImpl).not.toHaveBeenCalled();
  });

  it('downloads again when refresh is requested', async () => {
    const first = setup();
    first.fetchImpl.mockResolvedValueOnce(reply(okBody));
    await loadOverpassData(DEFAULT_BBOX, first.options);

    const second = setup();
    second.fetchImpl.mockResolvedValueOnce(reply(okBody));
    const result = await loadOverpassData(DEFAULT_BBOX, { ...second.options, refresh: true });

    expect(result.source).toBe('download');
    expect(second.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('explains what to do when the saved file is damaged', async () => {
    const { options } = setup();
    const first = setup();
    first.fetchImpl.mockResolvedValueOnce(reply(okBody));
    const { cacheFile } = await loadOverpassData(DEFAULT_BBOX, first.options);
    await writeFile(cacheFile, '{ esto no es json');

    await expect(loadOverpassData(DEFAULT_BBOX, options)).rejects.toThrow('--refresh');
  });
});

describe('loadOverpassData retries', () => {
  it('waits what the server asks (Retry-After) and tries the next server', async () => {
    const { fetchImpl, sleeps, options } = setup();
    fetchImpl
      .mockResolvedValueOnce(reply('busy', 429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(reply(okBody));

    const result = await loadOverpassData(DEFAULT_BBOX, options);

    expect(result.source).toBe('download');
    expect(sleeps).toEqual([2000]);
    expect(fetchImpl.mock.calls[1][0]).toBe(OVERPASS_ENDPOINTS[1]);
  });

  it('retries after a 503 with a growing delay', async () => {
    const { fetchImpl, sleeps, options } = setup();
    fetchImpl
      .mockResolvedValueOnce(reply('', 503))
      .mockResolvedValueOnce(reply('', 504))
      .mockResolvedValueOnce(reply(okBody));

    await loadOverpassData(DEFAULT_BBOX, options);

    expect(sleeps).toEqual([10, 30]);
  });

  it('retries when Overpass reports a runtime error inside a 200 answer', async () => {
    const { fetchImpl, options } = setup();
    fetchImpl
      .mockResolvedValueOnce(
        reply(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out' })),
      )
      .mockResolvedValueOnce(reply(okBody));

    const result = await loadOverpassData(DEFAULT_BBOX, options);

    expect(result.response.elements).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries when the answer is not valid JSON', async () => {
    const { fetchImpl, options } = setup();
    fetchImpl
      .mockResolvedValueOnce(reply('<html>Server too busy</html>'))
      .mockResolvedValueOnce(reply(okBody));

    await loadOverpassData(DEFAULT_BBOX, options);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries after a network error', async () => {
    const { fetchImpl, options } = setup();
    fetchImpl
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(reply(okBody));

    const result = await loadOverpassData(DEFAULT_BBOX, options);

    expect(result.source).toBe('download');
  });

  it('does not retry an error that will not change (400)', async () => {
    const { fetchImpl, sleeps, options } = setup();
    fetchImpl.mockResolvedValueOnce(reply('bad query', 400));

    await expect(loadOverpassData(DEFAULT_BBOX, options)).rejects.toThrow('400');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('gives up after the maximum attempts and says why', async () => {
    const { fetchImpl, sleeps, options } = setup();
    fetchImpl.mockImplementation(async () => reply('', 503));

    await expect(loadOverpassData(DEFAULT_BBOX, options)).rejects.toThrow('3 intentos');

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([10, 30]);
  });

  it('does not save anything when the download fails', async () => {
    const { fetchImpl, options } = setup();
    fetchImpl.mockImplementation(async () => reply('', 503));

    await expect(loadOverpassData(DEFAULT_BBOX, options)).rejects.toThrow();

    await expect(stat(join(directory, 'overpass-1.17_-77.32_1.25_-77.24.json'))).rejects.toThrow();
  });
});

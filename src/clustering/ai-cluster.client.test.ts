import { describe, expect, it, vi } from 'vitest';
import { AiClusterClient, AiClusterError } from './ai-cluster.client.js';
import type { AiClusterRequest } from './ai-contract.js';

const REQUEST: AiClusterRequest = {
  detections: [],
  asOf: '2026-11-16T12:00:00.000Z',
  epsM: 5,
  minPoints: 2,
};

const GOOD = {
  graphVersion: null,
  asOf: '2026-11-16T12:00:00Z',
  epsM: 5,
  minPoints: 2,
  detectionCount: 0,
  clusterCount: 0,
  confirmedCount: 0,
  placedCount: 0,
  computationMs: 1,
  clusters: [],
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function client(responses: (Response | Error)[], extra: { timeoutMs?: number } = {}) {
  const queue = [...responses];
  const fetchMock = vi.fn(async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error('no more answers');
    if (next instanceof Error) throw next;
    return next;
  });
  const sleeps: number[] = [];
  const instance = new AiClusterClient('https://ai.example.test', 'x'.repeat(40), {
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...extra,
  });
  return { instance, fetchMock, sleeps };
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AiClusterError) return error.failure;
    throw error;
  }
  throw new Error('it did not fail');
}

describe('AiClusterClient', () => {
  it('sends the request with the token and returns the parsed answer', async () => {
    const { instance, fetchMock } = client([json(GOOD)]);
    const answer = await instance.cluster(REQUEST);
    expect(answer.asOf).toEqual(new Date('2026-11-16T12:00:00Z'));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ai.example.test/clusters');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${'x'.repeat(40)}`);
    expect(init.redirect).toBe('manual');
    expect(JSON.parse(init.body as string)).toEqual(REQUEST);
  });

  it('keeps trying with growing pauses while Render wakes the service', async () => {
    const { instance, sleeps } = client([
      new Response('<html>loading</html>', { status: 503 }),
      json({}, 502),
      new Error('connection refused'),
      json(GOOD),
    ]);
    await instance.cluster(REQUEST);
    expect(sleeps).toEqual([2_000, 4_000, 8_000]);
  });

  it('obeys Retry-After', async () => {
    const { instance, sleeps } = client([json({}, 503, { 'retry-after': '7' }), json(GOOD)]);
    await instance.cluster(REQUEST);
    expect(sleeps).toEqual([7_000]);
  });

  it('gives up at once when Render says it will not wake the service', async () => {
    const { instance, fetchMock } = client([
      json({}, 429, { 'x-render-routing': 'hibernate-rate-limited' }),
    ]);
    const failure = await failureOf(instance.cluster(REQUEST));
    expect(failure).toEqual({ kind: 'hibernating', routing: 'hibernate-rate-limited' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a request the AI service refuses as rejected, with its code', async () => {
    const { instance } = client([json({ error: { code: 'TOO_MANY_DETECTIONS' } }, 422)]);
    expect(await failureOf(instance.cluster(REQUEST))).toEqual({
      kind: 'rejected',
      code: 'TOO_MANY_DETECTIONS',
    });
  });

  it('explains a token mismatch without printing the token', async () => {
    const { instance } = client([json({ error: { code: 'UNAUTHORIZED' } }, 401)]);
    const failure = await failureOf(instance.cluster(REQUEST));
    expect(failure.kind).toBe('unavailable');
    expect(JSON.stringify(failure)).toContain('INTERNAL_TOKEN');
    expect(JSON.stringify(failure)).not.toContain('xxxxxxxx');
  });

  it('does not follow redirects', async () => {
    const { instance, fetchMock } = client([new Response(null, { status: 302 })]);
    expect((await failureOf(instance.cluster(REQUEST))).kind).toBe('unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats an answer that breaks the contract as unavailable', async () => {
    const { instance } = client([json({ ...GOOD, clusters: [{ detectionIds: [] }] })]);
    expect((await failureOf(instance.cluster(REQUEST))).kind).toBe('unavailable');
  });

  it('stops after the time limit when the service never wakes up', async () => {
    let clock = 0;
    const fetchMock = vi.fn(async () => json({}, 503));
    const instance = new AiClusterClient('https://ai.example.test', 'x'.repeat(40), {
      fetch: fetchMock as unknown as typeof fetch,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      timeoutMs: 20_000,
    });
    const failure = await failureOf(instance.cluster(REQUEST));
    expect(failure.kind).toBe('unavailable');
    expect(fetchMock.mock.calls.length).toBeGreaterThan(2);
  });
});

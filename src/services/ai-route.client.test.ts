import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_RETRY_PAUSE_MS,
  AiRouteClient,
  AiRouteError,
  WAKE_UP_INTERVAL_MS,
  type AiRouteRequest,
  type AiRouteResponse,
} from './ai-route.client.js';

const TOKEN = '0123456789abcdef'.repeat(4);
const BASE = 'https://ai.example.com';

const request: AiRouteRequest = {
  origin: { latitude: 1.2136, longitude: -77.2811 },
  destination: { latitude: 1.215, longitude: -77.279 },
  k: 1,
  graphVersion: '07dc5415',
  algorithm: 'astar',
};

const route: AiRouteResponse = {
  algorithm: 'astar',
  graphVersion: '07dc5415',
  origin: { nodeId: 1042, latitude: 1.2136, longitude: -77.2811, distanceM: 3.2 },
  destination: { nodeId: 2210, latitude: 1.215, longitude: -77.279, distanceM: 1.1 },
  totalLengthM: 224,
  totalCost: 448,
  exploredNodes: 17,
  computationMs: 0,
  nodeIds: [1042, 1043, 2210],
  steps: [
    { segmentId: 1, reversed: false, lengthM: 112, damageScore: 0, cost: 112 },
    { segmentId: 2, reversed: true, lengthM: 112, damageScore: 2, cost: 336 },
  ],
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function aiError(status: number, code: string, details?: unknown): Response {
  return json(status, { error: { code, message: 'x', ...(details ? { details } : {}) } });
}

type Reply = Response | Error;

function fakeFetch(...replies: Reply[]) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const reply = replies.shift();
    if (!reply) throw new Error('no more replies');
    if (reply instanceof Error) throw reply;
    return reply;
  });
}

function makeClient(fetch: ReturnType<typeof fakeFetch>, extra: { timeoutMs?: number } = {}) {
  const pauses: number[] = [];
  const client = new AiRouteClient(BASE, TOKEN, {
    fetch: fetch as unknown as typeof globalThis.fetch,
    sleep: async (ms) => {
      pauses.push(ms);
    },
    ...extra,
  });
  return { client, pauses };
}

async function failure(promise: Promise<unknown>) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AiRouteError);
  return (error as AiRouteError).failure;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AiRouteClient.findRoute', () => {
  it('posts the request with the token and returns the route', async () => {
    const fetch = fakeFetch(json(200, route));
    const { client } = makeClient(fetch);

    await expect(client.findRoute(request)).resolves.toEqual(route);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${BASE}/routes`);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init?.body))).toEqual(request);
    expect(init?.redirect).toBe('manual');
  });

  it('turns NO_ROUTE into its own error, without trying again', async () => {
    const fetch = fakeFetch(aiError(404, 'NO_ROUTE'));
    const { client, pauses } = makeClient(fetch);

    expect(await failure(client.findRoute(request))).toEqual({ kind: 'no_route' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(pauses).toEqual([]);
  });

  it('turns OUTSIDE_NETWORK into its own error with its details', async () => {
    const details = { point: 'destination', distanceM: 450.2, maxDistanceM: 200 };
    const { client } = makeClient(fakeFetch(aiError(422, 'OUTSIDE_NETWORK', details)));

    expect(await failure(client.findRoute(request))).toEqual({
      kind: 'outside_network',
      ...details,
    });
  });

  it.each([
    ['a failed connection', new TypeError('fetch failed')],
    ['Render answering 502', new Response('<html>Bad Gateway</html>', { status: 502 })],
    ['Render answering 503', new Response('<html>waking up</html>', { status: 503 })],
    ['Render answering 504', new Response('', { status: 504 })],
  ])('tries once more, 2 s later, after %s', async (_case, first) => {
    const fetch = fakeFetch(first, json(200, route));
    const { client, pauses } = makeClient(fetch);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(client.findRoute(request)).resolves.toEqual(route);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(pauses).toEqual([AI_RETRY_PAUSE_MS]);
  });

  it('gives up after the second attempt', async () => {
    const fetch = fakeFetch(new TypeError('fetch failed'), new TypeError('fetch failed'));
    const { client } = makeClient(fetch);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await failure(client.findRoute(request));

    expect(result).toEqual({
      kind: 'unavailable',
      reason: 'could not connect to the AI service at ai.example.com',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [aiError(401, 'UNAUTHORIZED'), 'rejected INTERNAL_TOKEN'],
    [aiError(404, 'NOT_FOUND'), 'INTERNAL_TOKEN is not configured there'],
    [aiError(503, 'GRAPH_UNAVAILABLE'), 'GRAPH_UNAVAILABLE'],
    [aiError(422, 'INVALID_REQUEST'), 'HTTP 422 INVALID_REQUEST'],
    [aiError(500, 'INTERNAL_ERROR'), 'HTTP 500'],
    [json(200, { ...route, steps: 'not a list' }), 'does not follow the contract'],
    [new Response('not json', { status: 200 }), 'does not follow the contract'],
    [
      new Response(null, { status: 302, headers: { location: 'https://evil.example.com' } }),
      'redirect',
    ],
  ])('does not try again when it cannot help (%#)', async (reply, reason) => {
    const fetch = fakeFetch(reply);
    const { client, pauses } = makeClient(fetch);

    const result = await failure(client.findRoute(request));

    expect(result.kind).toBe('unavailable');
    expect(result.kind === 'unavailable' && result.reason).toContain(reason);
    expect(fetch).toHaveBeenCalledOnce();
    expect(pauses).toEqual([]);
  });

  it('stops waiting when the time is up', async () => {
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const client = new AiRouteClient(BASE, TOKEN, {
      fetch: fetch as unknown as typeof globalThis.fetch,
      timeoutMs: 50,
    });

    expect(await failure(client.findRoute(request))).toEqual({
      kind: 'unavailable',
      reason: 'the AI service did not answer within 0.05 s',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('never puts the token in an error or a log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetch = fakeFetch(new TypeError('fetch failed'), aiError(401, 'UNAUTHORIZED'));
    const { client } = makeClient(fetch);

    const error = await client.findRoute(request).catch((caught: unknown) => caught);

    expect(String((error as Error).message)).not.toContain(TOKEN);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN);
  });
});

describe('AiRouteClient.wakeUp', () => {
  it('pings /health in the background, without the token', async () => {
    const fetch = fakeFetch(json(200, { status: 'ok' }));
    const { client } = makeClient(fetch);

    client.wakeUp();

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${BASE}/health`);
    expect(new Headers(init?.headers).get('authorization')).toBeNull();
  });

  it('pings at most once every 5 minutes', () => {
    let now = 0;
    const fetch = fakeFetch(json(200, {}), json(200, {}));
    const client = new AiRouteClient(BASE, TOKEN, {
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => now,
    });

    client.wakeUp();
    now += WAKE_UP_INTERVAL_MS - 1;
    client.wakeUp();
    now += 1;
    client.wakeUp();

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('ignores a failed ping', async () => {
    const fetch = fakeFetch(new TypeError('fetch failed'));
    const { client } = makeClient(fetch);

    expect(() => client.wakeUp()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

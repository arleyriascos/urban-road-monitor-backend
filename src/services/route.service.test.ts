import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error.js';
import type { RouteSegmentRow } from '../repositories/route-geometry.repository.js';
import { routeRequestSchema, type RouteRequest } from '../routing/route-request.js';
import { LruCache } from '../structures/lru-cache.js';
import {
  AiRouteError,
  type AiRouteClient,
  type AiRouteRequest,
  type AiRouteResponse,
} from './ai-route.client.js';
import { NetworkVersionCache } from './network-version.service.js';
import { RouteService, type RouteResult } from './route.service.js';

const SEGMENTS: Record<number, RouteSegmentRow> = {
  11: {
    id: 11,
    roadName: 'Calle 18',
    geometry: [
      [1.2136, -77.2811],
      [1.2137, -77.2805],
    ],
  },
  12: {
    id: 12,
    roadName: null,
    geometry: [
      [1.215, -77.279],
      [1.2143, -77.2797],
      [1.2137, -77.2805],
    ],
  },
};

function aiRoute(overrides: Partial<AiRouteResponse> = {}): AiRouteResponse {
  return {
    algorithm: 'astar',
    graphVersion: 'v1',
    origin: { nodeId: 1042, latitude: 1.2136, longitude: -77.2811, distanceM: 3.2 },
    destination: { nodeId: 2210, latitude: 1.215, longitude: -77.279, distanceM: 1.1 },
    totalLengthM: 224.5,
    totalCost: 448.75,
    exploredNodes: 17,
    computationMs: 1,
    nodeIds: [1042, 1043, 2210],
    steps: [
      { segmentId: 11, reversed: false, lengthM: 112.2, damageScore: 0, cost: 112.2 },
      { segmentId: 12, reversed: true, lengthM: 112.3, damageScore: 2, cost: 336.55 },
    ],
    ...overrides,
  };
}

function setup(replies: (AiRouteResponse | AiRouteError)[] = [aiRoute()]) {
  const calls: AiRouteRequest[] = [];
  const client = {
    findRoute: vi.fn(async (request: AiRouteRequest) => {
      calls.push(request);
      const reply = replies.shift() ?? aiRoute();
      if (reply instanceof AiRouteError) throw reply;
      return reply;
    }),
  } as unknown as AiRouteClient;
  const geometry = {
    findSegments: vi.fn(async (ids: readonly number[]) =>
      ids.filter((id) => SEGMENTS[id]).map((id) => SEGMENTS[id]),
    ),
  };
  const versions = new NetworkVersionCache(async () => 'v1');
  const cache = new LruCache<RouteResult>(10);
  const service = new RouteService({ client, versions, geometry, cache });
  return { service, client, calls, geometry, cache };
}

function request(overrides: Record<string, unknown> = {}): RouteRequest {
  return routeRequestSchema.parse({
    origin: { latitude: 1.21361, longitude: -77.28112 },
    destination: { latitude: 1.21502, longitude: -77.27898 },
    ...overrides,
  });
}

async function appError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RouteService', () => {
  it('answers 503 when the route service is not configured', async () => {
    const service = new RouteService({
      client: null,
      versions: new NetworkVersionCache(async () => 'v1'),
      geometry: { findSegments: async () => [] },
      cache: new LruCache<RouteResult>(1),
    });

    const error = await appError(service.findRoute(request()));

    expect(service.isConfigured).toBe(false);
    expect(error).toMatchObject({ statusCode: 503, code: 'ROUTE_SERVICE_UNAVAILABLE' });
    expect(error.details).toEqual({ retryable: false });
  });

  it('asks the AI service with the rounded clicks, k and the network version', async () => {
    const { service, calls } = setup();

    await service.findRoute(request({ criterion: 'avoid_potholes', algorithm: 'dijkstra' }));

    expect(calls).toEqual([
      {
        origin: { latitude: 1.2136, longitude: -77.2811 },
        destination: { latitude: 1.215, longitude: -77.279 },
        k: 3,
        graphVersion: 'v1',
        algorithm: 'dijkstra',
      },
    ]);
  });

  it('builds the answer: points, summary and one line per step in travel order', async () => {
    const { service } = setup();

    const answer = await service.findRoute(request());

    expect(answer.fromCache).toBe(false);
    expect(answer.criterion).toBe('balanced');
    expect(answer.algorithm).toBe('astar');
    expect(answer.origin.nodeId).toBe(1042);
    expect(answer.summary).toEqual({
      lengthM: 224.5,
      cost: 448.75,
      steps: 2,
      exploredNodes: 17,
      computationMs: 1,
    });
    expect(answer.route.type).toBe('FeatureCollection');
    expect(answer.route.features.map((feature) => feature.properties)).toEqual([
      {
        order: 1,
        segmentId: 11,
        roadName: 'Calle 18',
        reversed: false,
        lengthM: 112.2,
        damageScore: 0,
        cost: 112.2,
      },
      {
        order: 2,
        segmentId: 12,
        roadName: null,
        reversed: true,
        lengthM: 112.3,
        damageScore: 2,
        cost: 336.55,
      },
    ]);
  });

  it('draws a segment crossed backwards from its last point to its first', async () => {
    const { service } = setup();

    const answer = await service.findRoute(request());

    // GeoJSON order is [longitude, latitude].
    expect(answer.route.features[0].geometry.coordinates).toEqual([
      [-77.2811, 1.2136],
      [-77.2805, 1.2137],
    ]);
    expect(answer.route.features[1].geometry.coordinates).toEqual([
      [-77.2805, 1.2137],
      [-77.2797, 1.2143],
      [-77.279, 1.215],
    ]);
    // The drawing stays continuous: each line starts where the previous one ends.
    expect(answer.route.features[1].geometry.coordinates[0]).toEqual(
      answer.route.features[0].geometry.coordinates.at(-1),
    );
  });

  it('answers the same route from the cache the second time', async () => {
    const { service, client } = setup();

    const first = await service.findRoute(request());
    const second = await service.findRoute(request());

    expect(second.fromCache).toBe(true);
    expect({ ...second, fromCache: false }).toEqual(first);
    expect(client.findRoute).toHaveBeenCalledOnce();
  });

  it('clicks a few meters apart share the cached route', async () => {
    const { service, client } = setup();

    await service.findRoute(request());
    const nearby = await service.findRoute(
      request({ origin: { latitude: 1.21364, longitude: -77.28114 } }),
    );

    expect(nearby.fromCache).toBe(true);
    expect(client.findRoute).toHaveBeenCalledOnce();
  });

  it('keeps each criterion and algorithm apart in the cache', async () => {
    const { service, client } = setup([aiRoute(), aiRoute(), aiRoute()]);

    await service.findRoute(request({ criterion: 'shortest' }));
    await service.findRoute(request({ criterion: 'balanced' }));
    await service.findRoute(request({ criterion: 'shortest', algorithm: 'dijkstra' }));

    expect(client.findRoute).toHaveBeenCalledTimes(3);
  });

  it('does not keep a route computed on another version of the network', async () => {
    const { service, client, cache } = setup([
      aiRoute({ graphVersion: 'v0' }),
      aiRoute({ graphVersion: 'v0' }),
    ]);

    const answer = await service.findRoute(request());
    await service.findRoute(request());

    expect(answer.fromCache).toBe(false);
    expect(client.findRoute).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });

  it('turns NO_ROUTE into a 404 and does not cache it', async () => {
    const { service, client } = setup([
      new AiRouteError({ kind: 'no_route' }),
      new AiRouteError({ kind: 'no_route' }),
    ]);

    const error = await appError(service.findRoute(request()));
    await service.findRoute(request()).catch(() => undefined);

    expect(error).toMatchObject({ statusCode: 404, code: 'NO_ROUTE' });
    expect(client.findRoute).toHaveBeenCalledTimes(2);
  });

  it('turns OUTSIDE_NETWORK into a 422 with which point and how far', async () => {
    const { service } = setup([
      new AiRouteError({
        kind: 'outside_network',
        point: 'destination',
        distanceM: 450.2,
        maxDistanceM: 200,
      }),
    ]);

    const error = await appError(service.findRoute(request()));

    expect(error).toMatchObject({ statusCode: 422, code: 'OUTSIDE_NETWORK' });
    expect(error.message).toBe(
      'The destination is 450 m from the nearest street; the limit is 200 m',
    );
    expect(error.details).toEqual({ point: 'destination', distanceM: 450.2, maxDistanceM: 200 });
  });

  it('turns any other failure into a retryable 503 and logs the reason', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { service } = setup([
      new AiRouteError({ kind: 'unavailable', reason: 'the AI service rejected INTERNAL_TOKEN' }),
    ]);

    const error = await appError(service.findRoute(request()));

    expect(error).toMatchObject({ statusCode: 503, code: 'ROUTE_SERVICE_UNAVAILABLE' });
    expect(error.details).toEqual({ retryable: true });
    expect(error.message).not.toContain('INTERNAL_TOKEN');
    expect(log).toHaveBeenCalledWith(
      'Route service unavailable: the AI service rejected INTERNAL_TOKEN',
    );
  });

  it('asks the client to wake the service and retry when Render will not wake it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { service } = setup([
      new AiRouteError({ kind: 'hibernating', routing: 'hibernate-rate-limited' }),
    ]);

    const error = await appError(service.findRoute(request()));

    expect(error).toMatchObject({ statusCode: 503, code: 'ROUTE_SERVICE_UNAVAILABLE' });
    expect(error.message).toBe('The route service is waking up; try again in a few seconds');
    expect(error.details).toEqual({ retryable: true, retryAfterS: 30 });
    expect(String(warn.mock.calls[0])).toContain('x-render-routing: hibernate-rate-limited');
  });

  it('answers 503 when the database cannot give the drawing of the segments', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { service, geometry } = setup();
    geometry.findSegments.mockRejectedValueOnce(new Error('connection refused'));

    const error = await appError(service.findRoute(request()));

    expect(error).toMatchObject({ statusCode: 503, code: 'DATABASE_UNAVAILABLE' });
  });

  it('answers 503 when a segment of the route is no longer in the database', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { service } = setup([
      aiRoute({
        steps: [{ segmentId: 99, reversed: false, lengthM: 10, damageScore: 0, cost: 10 }],
      }),
    ]);

    const error = await appError(service.findRoute(request()));

    expect(error).toMatchObject({ statusCode: 503, code: 'ROUTE_SERVICE_UNAVAILABLE' });
  });

  it('answers 503 when the network version cannot be computed', async () => {
    const service = new RouteService({
      client: { findRoute: vi.fn() } as unknown as AiRouteClient,
      versions: new NetworkVersionCache(async () => {
        throw new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not available right now');
      }),
      geometry: { findSegments: async () => [] },
      cache: new LruCache<RouteResult>(1),
    });

    const error = await appError(service.findRoute(request()));

    expect(error.code).toBe('DATABASE_UNAVAILABLE');
  });

  it('keeps the cached routes frozen, so no code can change them', async () => {
    const { service } = setup();
    await service.findRoute(request());

    const cached = await service.findRoute(request());

    expect(Object.isFrozen(cached.summary)).toBe(true);
    expect(Object.isFrozen(cached.route.features[0].geometry.coordinates[0])).toBe(true);
    expect(() => {
      (cached.summary as { lengthM: number }).lengthM = 0;
    }).toThrow(TypeError);
  });

  it('reports the hits and misses of the cache', async () => {
    const { service } = setup();
    await service.findRoute(request());
    await service.findRoute(request());

    expect(service.cacheStats()).toMatchObject({ hits: 1, misses: 1, size: 1, capacity: 10 });
  });
});

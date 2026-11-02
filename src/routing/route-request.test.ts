import { describe, expect, it } from 'vitest';
import {
  ROUTE_CRITERIA,
  normalizeRequest,
  roundCoordinate,
  routeCacheKey,
  routeRequestSchema,
} from './route-request.js';

const origin = { latitude: 1.2136, longitude: -77.2811 };
const destination = { latitude: 1.215, longitude: -77.279 };

describe('routeRequestSchema', () => {
  it('uses balanced and astar when they are not sent', () => {
    const parsed = routeRequestSchema.parse({ origin, destination });
    expect(parsed.criterion).toBe('balanced');
    expect(parsed.algorithm).toBe('astar');
  });

  it('maps each criterion to its damage factor', () => {
    expect(ROUTE_CRITERIA).toEqual({ shortest: 0, balanced: 1, avoid_potholes: 3 });
  });

  it.each([
    ['an unknown criterion', { origin, destination, criterion: 'fastest' }],
    ['an unknown algorithm', { origin, destination, algorithm: 'a_star' }],
    ['a latitude out of range', { origin: { latitude: 91, longitude: 0 }, destination }],
    ['a missing destination', { origin }],
    ['a raw k value', { origin, destination, k: 1 }],
    ['an extra field in a point', { origin: { ...origin, altitude: 2500 }, destination }],
    ['a coordinate as text', { origin: { latitude: '1.2', longitude: -77.28 }, destination }],
  ])('rejects %s', (_case, body) => {
    expect(routeRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('rounding and cache key', () => {
  it('rounds to 4 decimals', () => {
    expect(roundCoordinate(1.213649)).toBe(1.2136);
    expect(roundCoordinate(-77.281151)).toBe(-77.2812);
  });

  it('turns -0 into 0', () => {
    expect(Object.is(roundCoordinate(-0.00001), 0)).toBe(true);
  });

  it('rounds both clicks and keeps the rest', () => {
    const request = routeRequestSchema.parse({
      origin: { latitude: 1.21364, longitude: -77.28113 },
      destination,
      criterion: 'shortest',
    });
    expect(normalizeRequest(request)).toEqual({
      origin: { latitude: 1.2136, longitude: -77.2811 },
      destination: { latitude: 1.215, longitude: -77.279 },
      criterion: 'shortest',
      algorithm: 'astar',
    });
  });

  it('builds the key from the rounded clicks, the criterion, the algorithm and the version', () => {
    const request = routeRequestSchema.parse({ origin, destination });
    expect(routeCacheKey(request, '07dc5415')).toBe(
      '1.2136,-77.2811|1.215,-77.279|balanced|astar|07dc5415',
    );
  });

  it('gives the same key to clicks a few meters apart', () => {
    const a = routeRequestSchema.parse({
      origin: { latitude: 1.21361, longitude: -77.28111 },
      destination,
    });
    const b = routeRequestSchema.parse({
      origin: { latitude: 1.21364, longitude: -77.28114 },
      destination,
    });
    expect(routeCacheKey(a, 'v')).toBe(routeCacheKey(b, 'v'));
  });

  it('gives different keys to different criteria, algorithms or versions', () => {
    const base = routeRequestSchema.parse({ origin, destination });
    const keys = new Set([
      routeCacheKey(base, 'v1'),
      routeCacheKey(base, 'v2'),
      routeCacheKey({ ...base, criterion: 'avoid_potholes' }, 'v1'),
      routeCacheKey({ ...base, algorithm: 'dijkstra' }, 'v1'),
    ]);
    expect(keys.size).toBe(4);
  });
});

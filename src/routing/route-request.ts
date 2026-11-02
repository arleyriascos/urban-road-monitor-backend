import { z } from 'zod';

/**
 * What the frontend sends to POST /api/routes, and how it becomes a request to the AI
 * service and a key of the route cache.
 *
 * The frontend chooses a criterion by name; the damage factor k stays a backend detail:
 * the cost of a segment is length x (1 + k x damage).
 */
export const ROUTE_CRITERIA = { shortest: 0, balanced: 1, avoid_potholes: 3 } as const;
export type RouteCriterion = keyof typeof ROUTE_CRITERIA;

/** The same names the AI service and the route_requests table use. */
export const ROUTE_ALGORITHMS = ['astar', 'dijkstra'] as const;
export type RouteAlgorithm = (typeof ROUTE_ALGORITHMS)[number];

/** Clicks are rounded to 4 decimals (about 11 m) before anything else. */
const COORDINATE_DECIMALS = 4;

const pointSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();

export const routeRequestSchema = z
  .object({
    origin: pointSchema,
    destination: pointSchema,
    criterion: z
      .enum(Object.keys(ROUTE_CRITERIA) as [RouteCriterion, ...RouteCriterion[]])
      .default('balanced'),
    algorithm: z.enum(ROUTE_ALGORITHMS).default('astar'),
  })
  .strict();

export type RouteRequest = z.infer<typeof routeRequestSchema>;
export type Point = RouteRequest['origin'];

/** Round a coordinate to 4 decimals; -0 becomes 0, so equal points give equal keys. */
export function roundCoordinate(value: number): number {
  const rounded = Number(value.toFixed(COORDINATE_DECIMALS));
  return rounded === 0 ? 0 : rounded;
}

export function roundPoint(point: Point): Point {
  return { latitude: roundCoordinate(point.latitude), longitude: roundCoordinate(point.longitude) };
}

/**
 * The request with both clicks rounded. The route is computed for the rounded points
 * (at most about 8 m from the clicks), so a route from the cache is exactly the route
 * that would have been computed.
 */
export function normalizeRequest(request: RouteRequest): RouteRequest {
  return {
    ...request,
    origin: roundPoint(request.origin),
    destination: roundPoint(request.destination),
  };
}

/** Key of the route cache: origin | destination | criterion | algorithm | network version. */
export function routeCacheKey(request: RouteRequest, graphVersion: string): string {
  const { origin, destination } = normalizeRequest(request);
  return [
    `${origin.latitude},${origin.longitude}`,
    `${destination.latitude},${destination.longitude}`,
    request.criterion,
    request.algorithm,
    graphVersion,
  ].join('|');
}

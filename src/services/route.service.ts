import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { featureCollection, lineStringFeature } from '../geojson/mappers.js';
import type { FeatureCollection, LineStringGeometry } from '../geojson/types.js';
import {
  routeGeometryRepository,
  type RouteGeometryRepository,
  type RouteSegmentRow,
} from '../repositories/route-geometry.repository.js';
import {
  ROUTE_CRITERIA,
  normalizeRequest,
  routeCacheKey,
  type RouteAlgorithm,
  type RouteCriterion,
  type RouteRequest,
} from '../routing/route-request.js';
import { LruCache, type CacheStats } from '../structures/lru-cache.js';
import { AiRouteClient, AiRouteError, type AiRouteResponse } from './ai-route.client.js';
import { NetworkVersionCache } from './network-version.service.js';

export interface RoutePoint {
  nodeId: number;
  latitude: number;
  longitude: number;
  distanceM: number;
}

export interface RouteStepProperties {
  order: number;
  segmentId: number;
  roadName: string | null;
  reversed: boolean;
  lengthM: number;
  damageScore: number;
  cost: number;
}

export interface RouteResult {
  criterion: RouteCriterion;
  algorithm: RouteAlgorithm;
  origin: RoutePoint;
  destination: RoutePoint;
  summary: {
    lengthM: number;
    cost: number;
    steps: number;
    exploredNodes: number;
    computationMs: number;
  };
  route: FeatureCollection<LineStringGeometry, RouteStepProperties>;
}

/** What POST /api/routes answers: the route, and whether it came from the cache. */
export type RouteAnswer = RouteResult & { fromCache: boolean };

export interface RouteServiceDependencies {
  /** Null when AI_SERVICE_URL or INTERNAL_TOKEN is missing: routes answer 503. */
  client: AiRouteClient | null;
  versions: NetworkVersionCache;
  geometry: Pick<RouteGeometryRepository, 'findSegments'>;
  cache: LruCache<RouteResult>;
}

/**
 * Answers POST /api/routes:
 * 1. Round both clicks to 4 decimals; the route is computed for the rounded points.
 * 2. Get the network version (kept in memory for 10 s).
 * 3. Look for the route in the LRU cache; if it is there, answer at once.
 * 4. If not, ask the AI service, read the drawing of its segments, and build the answer.
 * 5. Keep it in the cache only if the AI service used the version that was asked for.
 */
export class RouteService {
  constructor(private readonly deps: RouteServiceDependencies) {}

  get isConfigured(): boolean {
    return this.deps.client !== null;
  }

  cacheStats(): CacheStats {
    return this.deps.cache.stats();
  }

  /** Start waking the AI service up in the background (at most once every 5 minutes). */
  wakeUp(): void {
    this.deps.client?.wakeUp();
  }

  async findRoute(request: RouteRequest): Promise<RouteAnswer> {
    const client = this.deps.client;
    if (!client) {
      throw new AppError(
        503,
        'ROUTE_SERVICE_UNAVAILABLE',
        'Routes are not available: the route service is not configured',
        { retryable: false },
      );
    }

    const rounded = normalizeRequest(request);
    const version = await this.deps.versions.current();
    const key = routeCacheKey(rounded, version);

    const cached = this.deps.cache.get(key);
    if (cached) {
      return { ...cached, fromCache: true };
    }

    const route = await this.askAiService(client, rounded, version);
    const segments = await this.readSegments(route);
    const result = deepFreeze(buildResult(rounded, route, segments));

    // A route computed on another version must not be kept under this version's key.
    if (route.graphVersion === version) {
      this.deps.cache.set(key, result);
    }
    return { ...result, fromCache: false };
  }

  private async askAiService(
    client: AiRouteClient,
    request: RouteRequest,
    version: string,
  ): Promise<AiRouteResponse> {
    try {
      return await client.findRoute({
        origin: request.origin,
        destination: request.destination,
        k: ROUTE_CRITERIA[request.criterion],
        graphVersion: version,
        algorithm: request.algorithm,
      });
    } catch (error) {
      if (!(error instanceof AiRouteError)) {
        throw error;
      }
      const failure = error.failure;
      if (failure.kind === 'no_route') {
        throw new AppError(
          404,
          'NO_ROUTE',
          'There is no route between these points that respects one-way streets',
        );
      }
      if (failure.kind === 'outside_network') {
        throw new AppError(
          422,
          'OUTSIDE_NETWORK',
          `The ${failure.point} is ${Math.round(failure.distanceM)} m from the nearest street; ` +
            `the limit is ${Math.round(failure.maxDistanceM)} m`,
          {
            point: failure.point,
            distanceM: failure.distanceM,
            maxDistanceM: failure.maxDistanceM,
          },
        );
      }
      console.error(`Route service unavailable: ${failure.reason}`);
      throw serviceUnavailable();
    }
  }

  private async readSegments(route: AiRouteResponse): Promise<Map<number, RouteSegmentRow>> {
    let rows: RouteSegmentRow[];
    try {
      rows = await this.deps.geometry.findSegments(route.steps.map((step) => step.segmentId));
    } catch (error) {
      console.error('Could not read the segments of a route:', error);
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not available right now');
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    const missing = route.steps.find((step) => !byId.has(step.segmentId));
    if (missing) {
      // The network changed between the version and this read: the next try will use the new one.
      console.error(
        `Route service: segment ${missing.segmentId} of a route is not in the database`,
      );
      throw serviceUnavailable();
    }
    return byId;
  }
}

function serviceUnavailable(): AppError {
  return new AppError(
    503,
    'ROUTE_SERVICE_UNAVAILABLE',
    'The route service is not available right now; try again in a moment',
    { retryable: true },
  );
}

function buildResult(
  request: RouteRequest,
  route: AiRouteResponse,
  segments: Map<number, RouteSegmentRow>,
): RouteResult {
  const features = route.steps.map((step, index) => {
    const segment = segments.get(step.segmentId) as RouteSegmentRow;
    // A segment crossed against its drawing is drawn backwards, so the line follows the trip.
    const points = step.reversed ? [...segment.geometry].reverse() : segment.geometry;
    const order = index + 1;
    return lineStringFeature<RouteStepProperties>(order, points, {
      order,
      segmentId: step.segmentId,
      roadName: segment.roadName,
      reversed: step.reversed,
      lengthM: step.lengthM,
      damageScore: step.damageScore,
      cost: step.cost,
    });
  });

  return {
    criterion: request.criterion,
    algorithm: request.algorithm,
    origin: route.origin,
    destination: route.destination,
    summary: {
      lengthM: route.totalLengthM,
      cost: route.totalCost,
      steps: route.steps.length,
      exploredNodes: route.exploredNodes,
      computationMs: route.computationMs,
    },
    route: featureCollection(features),
  };
}

/** Freeze an object and everything inside it, so no code can change what the cache shares. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) {
      deepFreeze(inner);
    }
  }
  return value;
}

function createRouteService(): RouteService {
  const client =
    env.AI_SERVICE_URL && env.INTERNAL_TOKEN
      ? new AiRouteClient(env.AI_SERVICE_URL, env.INTERNAL_TOKEN)
      : null;
  return new RouteService({
    client,
    versions: new NetworkVersionCache(),
    geometry: routeGeometryRepository,
    cache: new LruCache<RouteResult>(env.ROUTE_CACHE_CAPACITY),
  });
}

export const routeService = createRouteService();

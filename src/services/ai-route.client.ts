import { z } from 'zod';
import { ROUTE_ALGORITHMS, type Point, type RouteAlgorithm } from '../routing/route-request.js';

/**
 * Client of POST /routes of the AI service (the Python service on Render).
 *
 * - One wait of up to 75 s for the whole call: on Render's free plan a sleeping
 *   service can take close to a minute to wake up, and Render holds the request
 *   meanwhile.
 * - One more attempt, 2 s later, only when the connection failed or Render answered
 *   502, 503 or 504 while waking the service (those answers are not the AI service's
 *   own JSON errors).
 * - NO_ROUTE and OUTSIDE_NETWORK are answers, not failures: they become their own errors.
 * - Anything else (a token mismatch, GRAPH_UNAVAILABLE, a route that breaks the contract)
 *   is "unavailable", with a reason for the logs that says what to check.
 * - Redirects are not followed, so the token never goes to another address, and the
 *   token is never part of a message.
 */
export const AI_TIMEOUT_MS = 75_000;
export const AI_RETRY_PAUSE_MS = 2_000;
export const WAKE_UP_INTERVAL_MS = 5 * 60_000;
const RENDER_WAKING_STATUS = [502, 503, 504];

export interface AiRouteRequest {
  origin: Point;
  destination: Point;
  k: number;
  graphVersion: string;
  algorithm: RouteAlgorithm;
}

const snappedPointSchema = z.object({
  nodeId: z.number().int(),
  latitude: z.number(),
  longitude: z.number(),
  distanceM: z.number().nonnegative(),
});

/** The contract of the AI service's answer; anything else is treated as a failure. */
export const aiRouteResponseSchema = z.object({
  algorithm: z.enum(ROUTE_ALGORITHMS),
  graphVersion: z.string().min(1),
  origin: snappedPointSchema,
  destination: snappedPointSchema,
  totalLengthM: z.number().nonnegative(),
  totalCost: z.number().nonnegative(),
  exploredNodes: z.number().int().nonnegative(),
  computationMs: z.number().int().nonnegative(),
  nodeIds: z.array(z.number().int()).min(1),
  steps: z.array(
    z.object({
      segmentId: z.number().int(),
      reversed: z.boolean(),
      lengthM: z.number().nonnegative(),
      damageScore: z.number().nonnegative(),
      cost: z.number().nonnegative(),
    }),
  ),
});

export type AiRouteResponse = z.infer<typeof aiRouteResponseSchema>;

const outsideNetworkSchema = z.object({
  point: z.enum(['origin', 'destination']),
  distanceM: z.number(),
  maxDistanceM: z.number(),
});

export type AiRouteFailure =
  | { kind: 'no_route' }
  | ({ kind: 'outside_network' } & z.infer<typeof outsideNetworkSchema>)
  | { kind: 'unavailable'; reason: string };

export class AiRouteError extends Error {
  constructor(readonly failure: AiRouteFailure) {
    super(failure.kind === 'unavailable' ? failure.reason : failure.kind);
  }
}

export interface AiRouteClientOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  retryPauseMs?: number;
}

export class AiRouteClient {
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly retryPauseMs: number;
  private readonly host: string;
  private lastWakeUp = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    options: AiRouteClientOptions = {},
  ) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? AI_TIMEOUT_MS;
    this.retryPauseMs = options.retryPauseMs ?? AI_RETRY_PAUSE_MS;
    this.host = new URL(baseUrl).host;
  }

  async findRoute(request: AiRouteRequest): Promise<AiRouteResponse> {
    const deadline = AbortSignal.timeout(this.timeoutMs);

    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetch(`${this.baseUrl}/routes`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.token}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(request),
          redirect: 'manual',
          signal: deadline,
        });
      } catch {
        if (deadline.aborted) {
          throw unavailable(`the AI service did not answer within ${this.timeoutMs / 1000} s`);
        }
        if (attempt < 2) {
          await this.retryAfter(`could not connect to the AI service at ${this.host}`);
          continue;
        }
        throw unavailable(`could not connect to the AI service at ${this.host}`);
      }

      const body = await readJson(response);
      const code = errorCode(body);

      if (response.ok) {
        const parsed = aiRouteResponseSchema.safeParse(body);
        if (!parsed.success) {
          throw unavailable(
            'the AI service answered with a route that does not follow the contract',
          );
        }
        return parsed.data;
      }
      if (response.status === 404 && code === 'NO_ROUTE') {
        throw new AiRouteError({ kind: 'no_route' });
      }
      if (response.status === 422 && code === 'OUTSIDE_NETWORK') {
        const details = outsideNetworkSchema.safeParse(errorDetails(body));
        if (details.success) {
          throw new AiRouteError({ kind: 'outside_network', ...details.data });
        }
      }
      if (RENDER_WAKING_STATUS.includes(response.status) && code === undefined && attempt < 2) {
        await this.retryAfter(
          `Render answered HTTP ${response.status} while waking the AI service`,
        );
        continue;
      }
      throw unavailable(describeFailure(response.status, code));
    }
  }

  /**
   * Wake the AI service up in the background (GET /health, no token, no waiting), at most
   * once every 5 minutes. Called when someone opens the map, so the service is usually
   * awake by the time they ask for a route.
   */
  wakeUp(): void {
    const now = this.now();
    if (now - this.lastWakeUp < WAKE_UP_INTERVAL_MS) {
      return;
    }
    this.lastWakeUp = now;
    this.fetch(`${this.baseUrl}/health`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(this.timeoutMs),
    })
      .then((response) => response.body?.cancel())
      .catch(() => undefined);
  }

  private async retryAfter(reason: string): Promise<void> {
    console.warn(`AI service: ${reason}; trying again in ${this.retryPauseMs / 1000} s`);
    await this.sleep(this.retryPauseMs);
  }
}

function unavailable(reason: string): AiRouteError {
  return new AiRouteError({ kind: 'unavailable', reason });
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function errorCode(body: unknown): string | undefined {
  const code = (body as { error?: { code?: unknown } } | undefined)?.error?.code;
  return typeof code === 'string' ? code : undefined;
}

function errorDetails(body: unknown): unknown {
  return (body as { error?: { details?: unknown } } | undefined)?.error?.details;
}

function describeFailure(status: number, code: string | undefined): string {
  if (status === 401) {
    return 'the AI service rejected INTERNAL_TOKEN: it must be the same value in both services';
  }
  if (status === 404 && code === 'NOT_FOUND') {
    return 'the AI service answered 404: INTERNAL_TOKEN is not configured there, or AI_SERVICE_URL is wrong';
  }
  if (code === 'GRAPH_UNAVAILABLE') {
    return 'the AI service could not load the road graph (GRAPH_UNAVAILABLE)';
  }
  if (status >= 300 && status < 400) {
    return `the AI service answered with a redirect (HTTP ${status}); it is not followed, so the token stays with AI_SERVICE_URL`;
  }
  return `unexpected answer from the AI service (HTTP ${status}${code ? ` ${code}` : ''})`;
}

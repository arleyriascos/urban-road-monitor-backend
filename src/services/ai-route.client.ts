import { z } from 'zod';
import { ROUTE_ALGORITHMS, type Point, type RouteAlgorithm } from '../routing/route-request.js';

/**
 * Client of POST /routes of the AI service (the Python service on Render).
 *
 * - Up to 75 s for the whole call: on Render's free plan a sleeping service takes
 *   about a minute to wake up. Render does not always hold the request meanwhile: it
 *   can answer at once with 502, 503 or 504, or with its loading page (HTML, not JSON).
 * - While the service is waking up (a failed connection, one of those statuses without
 *   the AI service's own JSON error, or a page that is not JSON), the call keeps trying
 *   with growing pauses (2, 4, 8, 8... s) until the 75 s are used up.
 * - NO_ROUTE and OUTSIDE_NETWORK are answers, not failures: they become their own errors.
 * - Anything else (a token mismatch, GRAPH_UNAVAILABLE, a route that breaks the contract)
 *   is "unavailable", with a reason for the logs that says what to check.
 * - Redirects are not followed, so the token never goes to another address, and the
 *   token is never part of a message.
 */
export const AI_TIMEOUT_MS = 75_000;
/** Pauses between attempts while the AI service wakes up; the last one repeats. */
export const AI_RETRY_PAUSES_MS: readonly number[] = [2_000, 4_000, 8_000];
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
  retryPausesMs?: readonly number[];
}

/** One attempt either gets the route or finds the service still waking up. */
type Attempt = { route: AiRouteResponse } | { waking: string };

export class AiRouteClient {
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly retryPausesMs: readonly number[];
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
    this.retryPausesMs = options.retryPausesMs ?? AI_RETRY_PAUSES_MS;
    this.host = new URL(baseUrl).host;
  }

  async findRoute(request: AiRouteRequest): Promise<AiRouteResponse> {
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const startedAt = this.now();

    for (let retries = 0; ; retries++) {
      const attempt = await this.attempt(request, deadline);
      if ('route' in attempt) {
        return attempt.route;
      }
      const pause = this.retryPausesMs[Math.min(retries, this.retryPausesMs.length - 1)];
      if (deadline.aborted || this.now() - startedAt + pause >= this.timeoutMs) {
        throw unavailable(
          `the AI service did not wake up within ${this.timeoutMs / 1000} s (${attempt.waking})`,
        );
      }
      console.warn(`AI service: ${attempt.waking}; trying again in ${pause / 1000} s`);
      await this.sleep(pause);
    }
  }

  /** One call: the route, "still waking up", or a definite error (thrown). */
  private async attempt(request: AiRouteRequest, deadline: AbortSignal): Promise<Attempt> {
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
      return { waking: `could not connect to the AI service at ${this.host}` };
    }

    const status = response.status;
    if (status >= 300 && status < 400) {
      throw unavailable(describeFailure(status, undefined));
    }

    const body = await readJson(response);
    if (!body.ok) {
      // Render's loading page (or a bare 5xx) while the service starts; any other page,
      // such as a 404 from a wrong AI_SERVICE_URL, is a real error.
      if (status === 200 || status >= 500) {
        return {
          waking: `Render answered HTTP ${status} without JSON while waking the AI service`,
        };
      }
      throw unavailable(describeFailure(status, undefined));
    }

    const code = errorCode(body.value);
    if (response.ok) {
      const parsed = aiRouteResponseSchema.safeParse(body.value);
      if (!parsed.success) {
        throw unavailable('the AI service answered with a route that does not follow the contract');
      }
      return { route: parsed.data };
    }
    if (status === 404 && code === 'NO_ROUTE') {
      throw new AiRouteError({ kind: 'no_route' });
    }
    if (status === 422 && code === 'OUTSIDE_NETWORK') {
      const details = outsideNetworkSchema.safeParse(errorDetails(body.value));
      if (details.success) {
        throw new AiRouteError({ kind: 'outside_network', ...details.data });
      }
    }
    if (RENDER_WAKING_STATUS.includes(status) && code === undefined) {
      return { waking: `Render answered HTTP ${status} while waking the AI service` };
    }
    throw unavailable(describeFailure(status, code));
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
}

function unavailable(reason: string): AiRouteError {
  return new AiRouteError({ kind: 'unavailable', reason });
}

async function readJson(response: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await response.json() };
  } catch {
    return { ok: false };
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

import { parseRetryAfter } from '../services/ai-route.client.js';
import {
  aiClusterResponseSchema,
  type AiClusterRequest,
  type AiClusterResponse,
} from './ai-contract.js';

/**
 * Client of POST /clusters of the AI service (the Python service on Render). It behaves like the
 * client of the routes: the same token, no redirects, and the token is never part of a message.
 *
 * - Up to 75 s in all. On Render's free plan a sleeping service takes about a minute to wake,
 *   and meanwhile Render may answer 429, 502, 503 or 504 (without the AI service's own JSON
 *   error), or its loading page. Those are retried with growing pauses (2, 4, 8, 8... s).
 * - If Render says it will not wake the service for the backend (x-render-routing
 *   "hibernate-..."), waiting is useless: the call stops at once as "hibernating" and the
 *   consolidation tries again later (a browser wakes the service).
 * - Anything else is "unavailable" with a reason for the logs, or "rejected" when the AI service
 *   refuses the request itself (422).
 */
export const AI_CLUSTER_TIMEOUT_MS = 75_000;
export const AI_CLUSTER_RETRY_PAUSES_MS: readonly number[] = [2_000, 4_000, 8_000];
const RENDER_WAKING_STATUS = [429, 502, 503, 504];

export type AiClusterFailure =
  | { kind: 'hibernating'; routing: string }
  | { kind: 'rejected'; code: string }
  | { kind: 'unavailable'; reason: string };

export class AiClusterError extends Error {
  constructor(readonly failure: AiClusterFailure) {
    super(
      failure.kind === 'unavailable'
        ? failure.reason
        : failure.kind === 'rejected'
          ? `the AI service rejected the request (${failure.code})`
          : 'the AI service is hibernating',
    );
  }
}

export interface AiClusterClientOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  retryPausesMs?: readonly number[];
}

type Attempt = { answer: AiClusterResponse } | { waking: string; retryAfterMs?: number };

export class AiClusterClient {
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly retryPausesMs: readonly number[];
  private readonly host: string;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    options: AiClusterClientOptions = {},
  ) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? AI_CLUSTER_TIMEOUT_MS;
    this.retryPausesMs = options.retryPausesMs ?? AI_CLUSTER_RETRY_PAUSES_MS;
    this.host = new URL(baseUrl).host;
  }

  async cluster(request: AiClusterRequest): Promise<AiClusterResponse> {
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const startedAt = this.now();
    const body = JSON.stringify(request);

    for (let retries = 0; ; retries++) {
      const attempt = await this.attempt(body, deadline);
      if ('answer' in attempt) {
        return attempt.answer;
      }
      const pause =
        attempt.retryAfterMs ??
        this.retryPausesMs[Math.min(retries, this.retryPausesMs.length - 1)] ??
        0;
      if (deadline.aborted || this.now() - startedAt + pause >= this.timeoutMs) {
        throw unavailable(
          `the AI service did not wake up within ${this.timeoutMs / 1000} s (${attempt.waking})`,
        );
      }
      console.warn(`AI service: ${attempt.waking}; trying again in ${pause / 1000} s`);
      await this.sleep(pause);
    }
  }

  private async attempt(body: string, deadline: AbortSignal): Promise<Attempt> {
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}/clusters`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body,
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
      throw unavailable(`the AI service answered with a redirect (HTTP ${status}); not followed`);
    }
    const routing = safeHeader(response.headers.get('x-render-routing'));
    if (!response.ok && routing?.includes('hibernate')) {
      throw new AiClusterError({ kind: 'hibernating', routing });
    }

    const json = await readJson(response);
    if (!json.ok) {
      if (status === 200 || status === 429 || status >= 500) {
        return waking(response, 'without JSON ');
      }
      throw unavailable(describeFailure(status, undefined));
    }

    const code = errorCode(json.value);
    if (response.ok) {
      const parsed = aiClusterResponseSchema.safeParse(json.value);
      if (!parsed.success) {
        throw unavailable('the AI service answered with clusters that do not follow the contract');
      }
      return { answer: parsed.data };
    }
    if (status === 422 && code !== undefined) {
      throw new AiClusterError({ kind: 'rejected', code });
    }
    if (RENDER_WAKING_STATUS.includes(status) && code === undefined) {
      return waking(response, '');
    }
    throw unavailable(describeFailure(status, code));
  }
}

function waking(response: Response, detail: string): { waking: string; retryAfterMs?: number } {
  const routing = safeHeader(response.headers.get('x-render-routing'));
  const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
  return {
    waking:
      `Render answered HTTP ${response.status} ${detail}while waking the AI service` +
      (routing ? ` (x-render-routing: ${routing})` : ''),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

function safeHeader(value: string | null): string | undefined {
  const clean = value
    ?.replace(/[^\x20-\x7e]/g, '')
    .trim()
    .slice(0, 100);
  return clean ? clean : undefined;
}

function unavailable(reason: string): AiClusterError {
  return new AiClusterError({ kind: 'unavailable', reason });
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

function describeFailure(status: number, code: string | undefined): string {
  if (status === 401) {
    return 'the AI service rejected INTERNAL_TOKEN: it must be the same value in both services';
  }
  if (status === 404 && code === 'NOT_FOUND') {
    return 'the AI service answered 404: INTERNAL_TOKEN is not configured there, or AI_SERVICE_URL is wrong';
  }
  return `unexpected answer from the AI service (HTTP ${status}${code ? ` ${code}` : ''})`;
}

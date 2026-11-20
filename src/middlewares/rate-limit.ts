import { isIP } from 'node:net';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { LruCache } from '../structures/lru-cache.js';

/**
 * Limit of requests per IP address and minute. POST /api/routes uses it with 30 per minute;
 * other endpoints can have their own instance (each one counts apart) and their own message.
 *
 * Each address gets a one-minute window that starts with its first request. The windows
 * live in the LRU cache of the route cache (the same structure, reused), with room for
 * 10,000 addresses: memory has a cap even if many different addresses arrive, and an
 * address unused for long simply drops out and starts again.
 *
 * On Render the client address comes from the True-Client-IP header. Render puts
 * Cloudflare in front of every service, and Cloudflare writes that header with the real
 * client address, replacing whatever a client sends in it. X-Forwarded-For is not used:
 * the request crosses several proxies on its way in, and their number is not documented,
 * so no fixed "trust proxy" count is reliable (one hop counted each request under a
 * different proxy address, so the limit never applied). Without the header, as when the
 * backend runs on a computer, the address of the connection is used.
 */
export const ROUTE_REQUESTS_PER_MINUTE = 30;
const WINDOW_MS = 60_000;
const TRACKED_ADDRESSES = 10_000;

/** The address a request is counted under: True-Client-IP if it is a valid IP, else the connection's. */
export function clientAddress(req: Request): string {
  const forwarded = req.get('true-client-ip')?.trim();
  if (forwarded && isIP(forwarded) !== 0) {
    return forwarded;
  }
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

interface Window {
  readonly startedAt: number;
  readonly count: number;
}

/** The text of the 429 answer for a limit of `limit` requests per minute. */
function routeLimitMessage(limit: number): string {
  return `Too many route requests: the limit is ${limit} per minute`;
}

export interface RateLimitOptions {
  limit?: number;
  windowMs?: number;
  capacity?: number;
  now?: () => number;
  addressOf?: (req: Request) => string;
  /** Builds the text of the 429 answer; by default it talks about route requests. */
  message?: (limit: number) => string;
}

export function createRateLimit({
  limit = ROUTE_REQUESTS_PER_MINUTE,
  windowMs = WINDOW_MS,
  capacity = TRACKED_ADDRESSES,
  now = Date.now,
  addressOf = clientAddress,
  message = routeLimitMessage,
}: RateLimitOptions = {}): RequestHandler {
  const windows = new LruCache<Window>(capacity);

  return (req: Request, res: Response, next: NextFunction) => {
    const address = addressOf(req);
    const time = now();
    const current = windows.get(address);
    // A new object every time: the cache does not want its values changed.
    const window: Window =
      current && time - current.startedAt < windowMs
        ? { startedAt: current.startedAt, count: current.count + 1 }
        : { startedAt: time, count: 1 };
    windows.set(address, window);

    if (window.count > limit) {
      const retryAfterS = Math.max(1, Math.ceil((window.startedAt + windowMs - time) / 1000));
      res
        .set('Retry-After', String(retryAfterS))
        .status(429)
        .json({
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: message(limit),
            details: { retryAfterS },
          },
        });
      return;
    }
    next();
  };
}

export const routeRateLimit = createRateLimit();

/** Sign-in attempts per IP address and minute (POST /api/auth/google). Counted apart from routes. */
export const LOGIN_ATTEMPTS_PER_MINUTE = 10;

export const loginRateLimit = createRateLimit({
  limit: LOGIN_ATTEMPTS_PER_MINUTE,
  message: (limit) => `Too many sign-in attempts: the limit is ${limit} per minute`,
});

/** Registrations per IP address and 10 minutes (POST /api/auth/register). Counted apart from routes. */
export const REGISTER_ATTEMPTS_PER_10_MINUTES = 5;

export const registerRateLimit = createRateLimit({
  limit: REGISTER_ATTEMPTS_PER_10_MINUTES,
  windowMs: 10 * 60_000,
  message: (limit) => `Too many sign-up attempts: the limit is ${limit} per 10 minutes`,
});

/** Password sign-ins per IP address and minute (POST /api/auth/login). Counted apart from the rest. */
export const PASSWORD_LOGIN_ATTEMPTS_PER_MINUTE = 10;

export const passwordLoginRateLimit = createRateLimit({
  limit: PASSWORD_LOGIN_ATTEMPTS_PER_MINUTE,
  message: (limit) => `Too many sign-in attempts: the limit is ${limit} per minute`,
});

/**
 * Password sign-ins per EMAIL and 15 minutes. It stops someone who rotates IP addresses to
 * guess the password of one account. The price: someone can also use it to keep a person from
 * signing in for a while; that person still has Google and the recovery by e-mail.
 */
export const PASSWORD_LOGIN_ATTEMPTS_PER_EMAIL = 10;

export const passwordLoginEmailRateLimit = createRateLimit({
  limit: PASSWORD_LOGIN_ATTEMPTS_PER_EMAIL,
  windowMs: 15 * 60_000,
  addressOf: (req) => {
    const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
    return typeof email === 'string'
      ? `email:${email.trim().toLowerCase().slice(0, 255)}`
      : clientAddress(req);
  },
  message: (limit) =>
    `Too many sign-in attempts for this email: the limit is ${limit} per 15 minutes`,
});

/** Password changes per IP address and minute (POST /api/auth/password). */
export const PASSWORD_CHANGES_PER_MINUTE = 5;

export const passwordChangeRateLimit = createRateLimit({
  limit: PASSWORD_CHANGES_PER_MINUTE,
  message: (limit) => `Too many password changes: the limit is ${limit} per minute`,
});

/** Trip requests per IP address and minute (start, close, list, read). Counted apart from the rest. */
export const TRIP_REQUESTS_PER_MINUTE = 20;

export const tripsRateLimit = createRateLimit({
  limit: TRIP_REQUESTS_PER_MINUTE,
  message: (limit) => `Too many trip requests: the limit is ${limit} per minute`,
});

/** Batches of detections per IP address and minute. A batch holds up to 100 detections. */
export const DETECTION_BATCHES_PER_MINUTE = 60;

export const detectionsRateLimit = createRateLimit({
  limit: DETECTION_BATCHES_PER_MINUTE,
  message: (limit) => `Too many batches of detections: the limit is ${limit} per minute`,
});

/** Requests per IP address and minute to the consolidation routes (the administrator's). */
export const CLUSTERING_REQUESTS_PER_MINUTE = 10;

export const clusteringRateLimit = createRateLimit({
  limit: CLUSTERING_REQUESTS_PER_MINUTE,
  message: (limit) => `Too many consolidation requests: the limit is ${limit} per minute`,
});

/** Street summaries per IP address and minute. The map asks for one each time a segment is touched. */
export const SUMMARY_REQUESTS_PER_MINUTE = 120;

export const summaryRateLimit = createRateLimit({
  limit: SUMMARY_REQUESTS_PER_MINUTE,
  message: (limit) => `Too many street summary requests: the limit is ${limit} per minute`,
});

/** Typing in the search box asks a few times a second; the page waits a moment between letters. */
export const SEARCH_REQUESTS_PER_MINUTE = 120;

export const searchRateLimit = createRateLimit({
  limit: SEARCH_REQUESTS_PER_MINUTE,
  message: (limit) => `Too many street search requests: the limit is ${limit} per minute`,
});

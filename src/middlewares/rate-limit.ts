import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { LruCache } from '../structures/lru-cache.js';

/**
 * Limit of requests per IP address and minute, for POST /api/routes.
 *
 * Each address gets a one-minute window that starts with its first request. The windows
 * live in the LRU cache of the route cache (the same structure, reused), with room for
 * 10,000 addresses: memory has a cap even if many different addresses arrive, and an
 * address unused for long simply drops out and starts again.
 *
 * Behind Render's proxy the real address comes from X-Forwarded-For; app.ts sets
 * "trust proxy" to 1 so Express takes the address Render adds and not one a client invents.
 */
export const ROUTE_REQUESTS_PER_MINUTE = 30;
const WINDOW_MS = 60_000;
const TRACKED_ADDRESSES = 10_000;

interface Window {
  readonly startedAt: number;
  readonly count: number;
}

export interface RateLimitOptions {
  limit?: number;
  windowMs?: number;
  capacity?: number;
  now?: () => number;
}

export function createRateLimit({
  limit = ROUTE_REQUESTS_PER_MINUTE,
  windowMs = WINDOW_MS,
  capacity = TRACKED_ADDRESSES,
  now = Date.now,
}: RateLimitOptions = {}): RequestHandler {
  const windows = new LruCache<Window>(capacity);

  return (req: Request, res: Response, next: NextFunction) => {
    const address = req.ip ?? 'unknown';
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
            message: `Too many route requests: the limit is ${limit} per minute`,
            details: { retryAfterS },
          },
        });
      return;
    }
    next();
  };
}

export const routeRateLimit = createRateLimit();

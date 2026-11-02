import { isIP } from 'node:net';
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

export interface RateLimitOptions {
  limit?: number;
  windowMs?: number;
  capacity?: number;
  now?: () => number;
  addressOf?: (req: Request) => string;
}

export function createRateLimit({
  limit = ROUTE_REQUESTS_PER_MINUTE,
  windowMs = WINDOW_MS,
  capacity = TRACKED_ADDRESSES,
  now = Date.now,
  addressOf = clientAddress,
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

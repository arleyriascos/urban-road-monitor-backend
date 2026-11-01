import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { notFoundHandler } from './not-found.js';

const BEARER_PREFIX = /^Bearer\s+(.+)$/i;

/** SHA-256 of a text, so both tokens are compared as 32 bytes whatever their length. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Protects the /internal endpoints, which only the AI service calls.
 * It expects the header "Authorization: Bearer <INTERNAL_TOKEN>".
 *
 * - Without a configured token the endpoints do not exist: the answer is the same 404
 *   as any unknown route, so nobody can tell they are there.
 * - A missing or wrong token gets one 401 answer, with the same message in every case.
 * - The tokens are compared through their hashes with timingSafeEqual, so the response
 *   time reveals nothing about the right value or its length.
 * - The token is never logged or sent back.
 */
export function requireInternalToken(expectedToken: string | undefined): RequestHandler {
  const expected = expectedToken ? digest(expectedToken) : undefined;

  return (req: Request, res: Response, next: NextFunction) => {
    if (!expected) {
      notFoundHandler(req, res);
      return;
    }

    const match = BEARER_PREFIX.exec(req.get('authorization') ?? '');
    const received = digest(match?.[1]?.trim() ?? '');
    if (!match || !timingSafeEqual(received, expected)) {
      res
        .status(401)
        .set('WWW-Authenticate', 'Bearer realm="internal"')
        .set('Cache-Control', 'no-store')
        .json({
          error: { code: 'UNAUTHORIZED', message: 'A valid internal token is required' },
        });
      return;
    }

    next();
  };
}

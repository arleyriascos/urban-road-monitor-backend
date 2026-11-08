import type { RequestHandler, Response } from 'express';
import {
  sessionService,
  type AuthContext,
  type SessionService,
} from '../services/session.service.js';
import { clientAddress } from './rate-limit.js';

const BEARER = /^Bearer\s+(\S+)$/i;

/** The one answer for every session that does not work, whatever the reason. */
function reject(res: Response): void {
  res
    .status(401)
    .set('WWW-Authenticate', 'Bearer realm="session"')
    .set('Cache-Control', 'no-store')
    .json({ error: { code: 'UNAUTHORIZED', message: 'A valid session is required' } });
}

/**
 * Protects a route with a session. It expects "Authorization: Bearer <identifier>".
 *
 * - If there is no header, the identifier is malformed, the session does not exist, expired,
 *   was revoked or its person is inactive, the answer is the same 401 each time. The real
 *   reason only goes to the audit log, so the answer reveals nothing.
 * - If the database does not answer, the error is a 503 and not a 401: the frontend keeps
 *   the session on a 503 and drops it only on a 401.
 * - On success the person is left in res.locals.auth (read it with getAuth).
 *
 * Only the routes that need it use this middleware: the public ones (the map, the routes)
 * never read the Authorization header, so a broken session cannot break them.
 */
export function requireSession(
  service: Pick<SessionService, 'authenticate'> = sessionService,
): RequestHandler {
  return async (req, res, next) => {
    const token = BEARER.exec(req.get('authorization') ?? '')?.[1];
    if (!token) {
      reject(res);
      return;
    }

    const auth = await service.authenticate(token, {
      userAgent: req.get('user-agent'),
      ip: clientAddress(req),
    });
    if (!auth) {
      reject(res);
      return;
    }

    res.locals.auth = auth;
    next();
  };
}

/** The person that requireSession left in the response. Only for routes that use it. */
export function getAuth(res: Response): AuthContext {
  const auth = res.locals.auth as AuthContext | undefined;
  if (!auth) {
    throw new Error('getAuth was used on a route without requireSession');
  }
  return auth;
}

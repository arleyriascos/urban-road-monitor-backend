import type { RequestHandler } from 'express';
import { accountService, type AccountService } from '../services/account.service.js';
import { sessionService, type SessionService } from '../services/session.service.js';
import { authenticateRequest, getAuth } from './require-session.js';

/** A permission code is two lowercase words joined by a dot: detections.create. */
const PERMISSION_CODE = /^[a-z][a-z_]*\.[a-z][a-z_]*$/;

export interface PermissionDependencies {
  sessions?: Pick<SessionService, 'authenticate'>;
  accounts?: Pick<AccountService, 'hasPermission'>;
}

/**
 * Protects a route with a permission, not with a role: roles come and go, and the code
 * (for example "detections.create") says what the route needs. It works on its own, with no
 * need to put requireSession before it:
 *
 * - No session, or one that does not work: the same 401 as requireSession, and the
 *   permission is not even looked at.
 * - A session whose person has no role that grants the code: 403 FORBIDDEN. A refusal is not
 *   an attack, so it is not written to auth_logs.
 * - The permission is read from the tables on every request, with a single query, so a role
 *   given or taken away with npm run user:role applies on the very next request.
 * - If the database does not answer, the error is a 503 and never a 403.
 * - A code that no role grants (a misspelled one) refuses everybody, administrators too:
 *   a mistake closes the route, it never opens it.
 *
 * On success the person is left in res.locals.auth (read it with getAuth).
 */
export function requirePermission(
  code: string,
  { sessions = sessionService, accounts = accountService }: PermissionDependencies = {},
): RequestHandler {
  if (!PERMISSION_CODE.test(code)) {
    throw new Error(`"${code}" is not a permission code (for example detections.create)`);
  }

  return async (req, res, next) => {
    if (!(await authenticateRequest(sessions, req, res))) {
      return;
    }
    if (!(await accounts.hasPermission(getAuth(res).userId, code))) {
      res
        .status(403)
        .set('Cache-Control', 'no-store')
        .json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to do this' } });
      return;
    }
    next();
  };
}

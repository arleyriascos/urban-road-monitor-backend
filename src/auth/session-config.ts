/**
 * Settings of the sessions, in one place so they are easy to find and change.
 *
 * A session lasts 7 days from its last renewal, and never more than 30 days from the
 * moment it was opened. Each use renews it, but at most once per hour, so reading the
 * app does not write to the database on every request.
 */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a session lasts from its opening or its last renewal. */
export const SESSION_IDLE_MS = 7 * DAY_MS;

/** The most a session can last since it was opened, however much it is used. */
export const SESSION_MAX_MS = 30 * DAY_MS;

/** A session is renewed at most once in this time. */
export const SESSION_RENEW_EVERY_MS = 60 * 60 * 1000;

/** How many open sessions one person can have; opening one more revokes the least used. */
export const MAX_SESSIONS_PER_USER = 5;

/** The user agent is cut to this length before it is stored. */
export const USER_AGENT_MAX_LENGTH = 255;

/**
 * The expiry a session gets when it is renewed at `now`: seven more days, but never past
 * 30 days after it was created.
 */
export function renewedExpiry(createdAt: Date, now: Date): Date {
  const idleLimit = now.getTime() + SESSION_IDLE_MS;
  const absoluteLimit = createdAt.getTime() + SESSION_MAX_MS;
  return new Date(Math.min(idleLimit, absoluteLimit));
}

/** The expiry of a session opened at `now`. */
export function initialExpiry(now: Date): Date {
  return new Date(now.getTime() + SESSION_IDLE_MS);
}

/**
 * Whether a session that expires at `expiresAt` is due for renewal at `now`.
 * No column says when it was last renewed, but the expiry does: a session renewed less
 * than an hour ago expires in more than 7 days minus 1 hour.
 */
export function isDueForRenewal(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() - now.getTime() < SESSION_IDLE_MS - SESSION_RENEW_EVERY_MS;
}

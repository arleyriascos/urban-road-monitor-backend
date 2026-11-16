const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** The phone clock may be ahead of the server's by this much without anyone caring. */
export const CLOCK_SKEW_MS = 2 * MINUTE_MS;

/** A phone that lost the connection may still send the detections of a trip this long after it ended. */
export const LATE_DETECTIONS_GRACE_MS = DAY_MS;

/** A start time older than this is not believed: the phone clock is wrong. */
const MAX_START_AGE_MS = 2 * DAY_MS;

/**
 * When a trip starts. The phone's time is used when it is believable: not in the future (beyond
 * the clock skew) and not older than two days. Otherwise the server's time is used.
 */
export function chooseStartedAt(claimed: Date | undefined, now: Date): Date {
  if (claimed === undefined) {
    return now;
  }
  const time = claimed.getTime();
  const tooNew = time > now.getTime() + CLOCK_SKEW_MS;
  const tooOld = time < now.getTime() - MAX_START_AGE_MS;
  return tooNew || tooOld ? now : claimed;
}

/**
 * When a trip ends. The phone's time is used when it falls between the start of the trip and
 * now (plus the clock skew); otherwise the end is now, but never before the start.
 */
export function chooseEndedAt(claimed: Date | undefined, startedAt: Date, now: Date): Date {
  const fallback = new Date(Math.max(now.getTime(), startedAt.getTime()));
  if (claimed === undefined) {
    return fallback;
  }
  const time = claimed.getTime();
  const believable = time >= startedAt.getTime() && time <= now.getTime() + CLOCK_SKEW_MS;
  return believable ? claimed : fallback;
}

/**
 * Whether a trip still takes detections: while it is open, and for a day after it ended.
 * That is the time the queue of a phone without signal may need to empty itself.
 */
export function acceptsDetections(trip: { endedAt: Date | null }, now: Date): boolean {
  return (
    trip.endedAt === null || now.getTime() - trip.endedAt.getTime() <= LATE_DETECTIONS_GRACE_MS
  );
}

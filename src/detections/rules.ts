import type { DetectionInput } from './detection-input.js';

/** Why a detection is not stored. The phone gets the code, so it can drop the detection. */
export type RejectionReason =
  'in_the_future' | 'too_old' | 'before_trip' | 'gps_not_accurate' | 'low_confidence';

/** What a detection is judged against. */
export interface AcceptanceLimits {
  /** The moment of the judgment. */
  now: Date;
  /** The phone clock may be a little ahead: up to this many milliseconds are forgiven. */
  clockSkewMs: number;
  /** A detection older than this is not stored: the queue of a phone that was offline for weeks. */
  maxAgeMs: number;
  /** Detections with a worse GPS (a bigger error in meters) are discarded. */
  maxGpsAccuracyM: number;
  /** The confidence threshold of the active model. */
  minConfidence: number;
  /** When the trip started; a detection cannot be older than the trip by more than the skew. */
  tripStartedAt: Date;
}

/** The first rule a detection breaks, or null if it is good. The order is the one of the type. */
export function rejectionOf(
  detection: DetectionInput,
  limits: AcceptanceLimits,
): RejectionReason | null {
  const time = detection.detectedAt.getTime();
  const now = limits.now.getTime();
  if (time > now + limits.clockSkewMs) {
    return 'in_the_future';
  }
  if (time < now - limits.maxAgeMs) {
    return 'too_old';
  }
  if (time < limits.tripStartedAt.getTime() - limits.clockSkewMs) {
    return 'before_trip';
  }
  if (detection.gpsAccuracyM !== undefined && detection.gpsAccuracyM > limits.maxGpsAccuracyM) {
    return 'gps_not_accurate';
  }
  if (detection.confidence < limits.minConfidence) {
    return 'low_confidence';
  }
  return null;
}

export interface Rejected {
  id: string;
  reason: RejectionReason;
}

export interface Judgment {
  accepted: DetectionInput[];
  rejected: Rejected[];
}

/** Splits a batch into the detections to store and the ones to refuse, keeping the order. */
export function judgeDetections(
  detections: readonly DetectionInput[],
  limits: AcceptanceLimits,
): Judgment {
  const accepted: DetectionInput[] = [];
  const rejected: Rejected[] = [];
  for (const detection of detections) {
    const reason = rejectionOf(detection, limits);
    if (reason === null) {
      accepted.push(detection);
    } else {
      rejected.push({ id: detection.id, reason });
    }
  }
  return { accepted, rejected };
}

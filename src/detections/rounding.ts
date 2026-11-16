import type { DetectionInput } from './detection-input.js';

/** A detection with the precision the table keeps: what is stored is what is compared. */
export type RoundedDetection = DetectionInput;

function round(value: number, decimals: number): number {
  const rounded = Number(value.toFixed(decimals));
  return rounded === 0 ? 0 : rounded; // -0 becomes 0
}

/**
 * Rounds a detection to the columns of the table: coordinates to 6 decimals (about 10 cm),
 * the GPS accuracy to 2, the confidence and the area to 4. An area that rounds to zero becomes
 * 0.0001, because the table only accepts areas above zero.
 */
export function roundDetection(detection: DetectionInput): RoundedDetection {
  return {
    ...detection,
    latitude: round(detection.latitude, 6),
    longitude: round(detection.longitude, 6),
    ...(detection.gpsAccuracyM === undefined
      ? {}
      : { gpsAccuracyM: round(detection.gpsAccuracyM, 2) }),
    confidence: round(detection.confidence, 4),
    bboxAreaRatio: Math.max(0.0001, round(detection.bboxAreaRatio, 4)),
  };
}

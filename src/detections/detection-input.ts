import { z } from 'zod';

/**
 * One detection as the phone sends it: where a pothole was seen, how sure the model was and how
 * much of the picture its box covered.
 *
 * The phone chooses the id (a UUID made there), so a batch that is sent again after a bad
 * connection is recognised and stored once. The severity is not sent: the server works it out
 * from bboxAreaRatio with the table of severity levels.
 */
export const detectionSchema = z
  .object({
    id: z.uuid(),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    /** Error of the GPS in meters, as the browser reports it. */
    gpsAccuracyM: z.number().finite().min(0).max(100_000).optional(),
    /** How sure the vision model was, from 0 to 1. */
    confidence: z.number().finite().min(0).max(1),
    /** Share of the picture the box covers: more than 0 and at most 1. */
    bboxAreaRatio: z.number().finite().gt(0).max(1),
    /** When the phone saw it, as an ISO date with a time zone. */
    detectedAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  })
  .strict();

export type DetectionInput = z.infer<typeof detectionSchema>;

import { z } from 'zod';
import { detectionSchema } from './detection-input.js';

/**
 * The most detections one request may carry. The phone keeps a queue of up to 500 and sends
 * it in batches: 100 detections are about 25 KB of JSON, well under the body limit.
 */
export const MAX_BATCH_SIZE = 100;

/** What the phone sends to POST /api/trips/:id/detections. */
export const detectionBatchSchema = z
  .object({
    detections: z.array(detectionSchema).min(1).max(MAX_BATCH_SIZE),
  })
  .strict()
  .refine(
    ({ detections }) =>
      new Set(detections.map((detection) => detection.id)).size === detections.length,
    { message: 'detection ids must be unique inside a batch', path: ['detections'] },
  );

export type DetectionBatch = z.infer<typeof detectionBatchSchema>;

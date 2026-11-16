import { describe, expect, it } from 'vitest';
import { MAX_BATCH_SIZE } from '../detections/batch-input.js';
import { detectionSchema } from '../detections/detection-input.js';
import type { RejectionReason } from '../detections/rules.js';
import { DETECTION_BATCHES_PER_MINUTE } from '../middlewares/rate-limit.js';
import { detectionPaths, detectionSchemas } from './detections-openapi.js';
import { openApiDocument } from './openapi.js';

const post = detectionPaths['/api/trips/{tripId}/detections'].post;

describe('detections documentation', () => {
  it('describes one operation, in the Trips tag, that needs a session', () => {
    expect(Object.keys(detectionPaths)).toEqual(['/api/trips/{tripId}/detections']);
    expect(post.tags).toEqual(['Trips']);
    expect(post.security).toEqual([{ sessionToken: [] }]);
    expect(openApiDocument.paths).toHaveProperty('/api/trips/{tripId}/detections');
  });

  it('says the limits the backend applies', () => {
    expect(post.description).toContain(`${MAX_BATCH_SIZE} detections`);
    expect(post.description).toContain(`${DETECTION_BATCHES_PER_MINUTE} batches`);
    expect(detectionSchemas.DetectionBatch.properties.detections.maxItems).toBe(MAX_BATCH_SIZE);
  });

  it('asks for the same fields the validation asks for', () => {
    expect(Object.keys(detectionSchemas.DetectionInput.properties).sort()).toEqual(
      Object.keys(detectionSchema.shape).sort(),
    );
    expect(detectionSchemas.DetectionInput.required).toEqual([
      'id',
      'latitude',
      'longitude',
      'confidence',
      'bboxAreaRatio',
      'detectedAt',
    ]);
  });

  it('lists every reason a detection can be refused for', () => {
    const reasons: RejectionReason[] = [
      'in_the_future',
      'too_old',
      'before_trip',
      'gps_not_accurate',
      'low_confidence',
    ];
    expect([...detectionSchemas.RejectedDetection.properties.reason.enum].sort()).toEqual(
      [...reasons].sort(),
    );
  });

  it('documents the answers of the route, including the closed trip', () => {
    expect(Object.keys(post.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '409',
      '429',
      '503',
    ]);
    expect(post.responses[409].description).toContain('TRIP_CLOSED');
  });
});

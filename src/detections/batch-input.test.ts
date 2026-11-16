import { describe, expect, it } from 'vitest';
import { detectionBatchSchema, MAX_BATCH_SIZE } from './batch-input.js';

function detection(n: number) {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    latitude: 1.2136,
    longitude: -77.2811,
    confidence: 0.7,
    bboxAreaRatio: 0.02,
    detectedAt: '2026-11-16T12:00:00Z',
  };
}

describe('detectionBatchSchema', () => {
  it('reads a batch of detections', () => {
    const parsed = detectionBatchSchema.parse({ detections: [detection(1), detection(2)] });

    expect(parsed.detections).toHaveLength(2);
  });

  it('accepts a full batch', () => {
    const detections = Array.from({ length: MAX_BATCH_SIZE }, (_, i) => detection(i + 1));

    expect(detectionBatchSchema.safeParse({ detections }).success).toBe(true);
  });

  it('refuses a batch that is too big', () => {
    const detections = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => detection(i + 1));

    expect(detectionBatchSchema.safeParse({ detections }).success).toBe(false);
  });

  it('refuses an empty batch', () => {
    expect(detectionBatchSchema.safeParse({ detections: [] }).success).toBe(false);
  });

  it('refuses two detections with the same id and says so', () => {
    const result = detectionBatchSchema.safeParse({ detections: [detection(1), detection(1)] });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('unique');
  });

  it('says which detection is wrong', () => {
    const result = detectionBatchSchema.safeParse({
      detections: [detection(1), { ...detection(2), confidence: 3 }],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['detections', 1, 'confidence']);
  });

  it('refuses extra fields and a missing list', () => {
    expect(
      detectionBatchSchema.safeParse({ detections: [detection(1)], tripId: 'x' }).success,
    ).toBe(false);
    expect(detectionBatchSchema.safeParse({}).success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WINDOW_RADIUS,
  MAX_WINDOW_RADIUS,
  roadSummaryInputSchema,
  segmentSummaryInputSchema,
} from './summary-input.js';

const segment = (id: unknown, query: Record<string, unknown> = {}) =>
  segmentSummaryInputSchema.safeParse({ params: { id }, query });
const road = (id: unknown, query: Record<string, unknown> = {}) =>
  roadSummaryInputSchema.safeParse({ params: { id }, query });

describe('segmentSummaryInputSchema', () => {
  it('reads the id and uses the default radius', () => {
    expect(segment('42')).toMatchObject({
      success: true,
      data: { segmentId: 42, radius: DEFAULT_WINDOW_RADIUS },
    });
  });

  it('reads the radius, from 0 to the maximum', () => {
    expect(segment('42', { radius: '0' })).toMatchObject({ success: true, data: { radius: 0 } });
    expect(segment('42', { radius: String(MAX_WINDOW_RADIUS) }).success).toBe(true);
    expect(segment('42', { radius: String(MAX_WINDOW_RADIUS + 1) }).success).toBe(false);
  });

  it.each(['0', '-1', '1.5', '1e3', 'abc', '', ' 5', '5 ', '9999999999999999', '007'])(
    'refuses the id %j',
    (id) => {
      expect(segment(id).success).toBe(false);
    },
  );

  it.each(['-1', '1.5', '1e1', 'two', '', ['1', '2']])('refuses the radius %j', (radius) => {
    expect(segment('1', { radius }).success).toBe(false);
  });

  it('refuses a parameter it does not know', () => {
    expect(segment('1', { other: '1' }).success).toBe(false);
  });
});

describe('roadSummaryInputSchema', () => {
  it('means the whole street when there is no range', () => {
    expect(road('7')).toMatchObject({ success: true, data: { roadId: 7, range: undefined } });
  });

  it('reads a range, both ends included', () => {
    expect(road('7', { from: '2', to: '9' })).toMatchObject({
      success: true,
      data: { roadId: 7, range: { from: 2, to: 9 } },
    });
    expect(road('7', { from: '4', to: '4' }).success).toBe(true);
  });

  it('wants both ends or none, and the first not after the second', () => {
    expect(road('7', { from: '2' }).success).toBe(false);
    expect(road('7', { to: '2' }).success).toBe(false);
    expect(road('7', { from: '5', to: '2' }).success).toBe(false);
  });

  it('refuses numbers that are not whole, negative or absurdly big', () => {
    expect(road('7', { from: '-1', to: '2' }).success).toBe(false);
    expect(road('7', { from: '1.5', to: '2' }).success).toBe(false);
    expect(road('7', { from: '0', to: '100001' }).success).toBe(false);
  });

  it('refuses a bad id or an unknown parameter', () => {
    expect(road('0').success).toBe(false);
    expect(road('x').success).toBe(false);
    expect(road('7', { other: '1' }).success).toBe(false);
  });
});

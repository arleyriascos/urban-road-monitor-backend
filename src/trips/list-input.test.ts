import { describe, expect, it } from 'vitest';
import { listTripsQuerySchema } from './list-input.js';

describe('listTripsQuerySchema', () => {
  it('uses a page of 20 when nothing is asked', () => {
    expect(listTripsQuerySchema.parse({})).toEqual({ limit: 20 });
  });

  it('reads the limit as the text it arrives as in a query string', () => {
    expect(listTripsQuerySchema.parse({ limit: '5', cursor: 'abc' })).toEqual({
      limit: 5,
      cursor: 'abc',
    });
  });

  it.each(['0', '51', '-1', '1.5', 'many', ''])('refuses the limit "%s"', (limit) => {
    expect(listTripsQuerySchema.safeParse({ limit }).success).toBe(false);
  });

  it('refuses an empty or very long cursor and fields nobody asked for', () => {
    expect(listTripsQuerySchema.safeParse({ cursor: '' }).success).toBe(false);
    expect(listTripsQuerySchema.safeParse({ cursor: 'a'.repeat(201) }).success).toBe(false);
    expect(listTripsQuerySchema.safeParse({ user: 'x' }).success).toBe(false);
  });
});

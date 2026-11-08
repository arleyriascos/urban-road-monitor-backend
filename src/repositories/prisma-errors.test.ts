import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './prisma-errors.js';

describe('isUniqueViolation', () => {
  it('is true for an error with the code P2002', () => {
    expect(
      isUniqueViolation(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })),
    ).toBe(true);
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
  });

  it.each([
    ['another Prisma code', { code: 'P2025' }],
    ['a database code', { code: '23505' }],
    ['a plain error', new Error('boom')],
    ['an object without a code', {}],
    ['a code that is not a text', { code: 2002 }],
    ['null', null],
    ['undefined', undefined],
    ['a text', 'P2002'],
    ['a number', 2002],
  ])('is false for %s', (_name, error) => {
    expect(isUniqueViolation(error)).toBe(false);
  });
});

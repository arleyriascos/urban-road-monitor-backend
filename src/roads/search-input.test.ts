import { describe, expect, it } from 'vitest';
import { MAX_QUERY_LENGTH, roadSearchInputSchema } from './search-input.js';

const parse = (query: unknown) => roadSearchInputSchema.safeParse({ query });

describe('roadSearchInputSchema', () => {
  it('takes the text and gives the default number of suggestions', () => {
    expect(parse({ q: 'calle' })).toMatchObject({
      success: true,
      data: { text: 'calle', limit: 8 },
    });
  });

  it('trims the text and reads the limit', () => {
    expect(parse({ q: '  cal ', limit: '3' })).toMatchObject({
      success: true,
      data: { text: 'cal', limit: 3 },
    });
  });

  it.each([
    [{}, 'no text'],
    [{ q: '' }, 'empty text'],
    [{ q: '   ' }, 'blank text'],
    [{ q: 'a'.repeat(MAX_QUERY_LENGTH + 1) }, 'text too long'],
    [{ q: ['a', 'b'] }, 'text repeated'],
    [{ q: 'a', limit: '0' }, 'limit 0'],
    [{ q: 'a', limit: '21' }, 'limit over the maximum'],
    [{ q: 'a', limit: '2.5' }, 'limit with decimals'],
    [{ q: 'a', limit: '-1' }, 'negative limit'],
    [{ q: 'a', limit: '1e1' }, 'limit in scientific notation'],
    [{ q: 'a', other: '1' }, 'an unknown field'],
  ])('rejects %j (%s)', (query: unknown, _why: string) => {
    expect(parse(query).success).toBe(false);
  });

  it('accepts the text at the maximum length', () => {
    expect(parse({ q: 'a'.repeat(MAX_QUERY_LENGTH) }).success).toBe(true);
  });
});

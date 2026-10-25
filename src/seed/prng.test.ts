import { describe, expect, it } from 'vitest';
import { createRandom, pick, randomInt, shuffle, weightedPick } from './prng.js';

const draw = (seed: number, amount: number) => {
  const random = createRandom(seed);
  return Array.from({ length: amount }, () => random());
};

describe('createRandom', () => {
  it('gives the same sequence for the same seed', () => {
    expect(draw(2026, 5)).toEqual(draw(2026, 5));
  });

  it('gives a different sequence for another seed', () => {
    expect(draw(1, 5)).not.toEqual(draw(2, 5));
  });

  it('returns numbers from 0 (included) to 1 (excluded)', () => {
    for (const value of draw(7, 1_000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('randomInt', () => {
  it('stays within the limits and reaches both ends', () => {
    const random = createRandom(3);
    const values = Array.from({ length: 500 }, () => randomInt(random, 2, 5));
    expect(Math.min(...values)).toBe(2);
    expect(Math.max(...values)).toBe(5);
  });
});

describe('pick', () => {
  it('returns an element of the list', () => {
    expect(['a', 'b', 'c']).toContain(pick(createRandom(1), ['a', 'b', 'c']));
  });

  it('refuses an empty list', () => {
    expect(() => pick(createRandom(1), [])).toThrow('empty');
  });
});

describe('weightedPick', () => {
  it('never picks an option with weight 0', () => {
    const random = createRandom(5);
    const options = [
      { value: 'never', weight: 0 },
      { value: 'always', weight: 1 },
    ];
    for (let i = 0; i < 200; i++) expect(weightedPick(random, options)).toBe('always');
  });

  it('picks in proportion to the weights', () => {
    const random = createRandom(11);
    const options = [
      { value: 'a', weight: 1 },
      { value: 'b', weight: 3 },
    ];
    const picks = Array.from({ length: 10_000 }, () => weightedPick(random, options));
    const shareOfB = picks.filter((value) => value === 'b').length / picks.length;
    expect(shareOfB).toBeGreaterThan(0.72);
    expect(shareOfB).toBeLessThan(0.78);
  });
});

describe('shuffle', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8];

  it('keeps the same elements and does not change the original list', () => {
    const shuffled = shuffle(createRandom(9), items);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('is repeatable for the same seed', () => {
    expect(shuffle(createRandom(9), items)).toEqual(shuffle(createRandom(9), items));
  });

  it('changes the order', () => {
    expect(shuffle(createRandom(9), items)).not.toEqual(items);
  });
});

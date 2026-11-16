import { describe, expect, it } from 'vitest';
import { classifySeverity, type SeverityLevel } from './severity.js';

const LEVELS: SeverityLevel[] = [
  { id: 1, name: 'leve', minAreaRatio: 0, maxAreaRatio: 0.01 },
  { id: 2, name: 'moderado', minAreaRatio: 0.01, maxAreaRatio: 0.04 },
  { id: 3, name: 'grave', minAreaRatio: 0.04, maxAreaRatio: 1 },
];

describe('classifySeverity', () => {
  it.each([
    [0.0001, 'leve'],
    [0.0099, 'leve'],
    [0.02, 'moderado'],
    [0.0399, 'moderado'],
    [0.2, 'grave'],
    [1, 'grave'],
  ])('puts %s in %s', (ratio, name) => {
    expect(classifySeverity(ratio, LEVELS)?.name).toBe(name);
  });

  it('gives the border to the worse level: exactly 1 % is moderado, exactly 4 % is grave', () => {
    expect(classifySeverity(0.01, LEVELS)?.name).toBe('moderado');
    expect(classifySeverity(0.04, LEVELS)?.name).toBe('grave');
  });

  it('does not depend on the order of the levels it is given', () => {
    const shuffled = [LEVELS[2]!, LEVELS[0]!, LEVELS[1]!];

    expect(classifySeverity(0.02, shuffled)?.name).toBe('moderado');
    expect(classifySeverity(1, shuffled)?.name).toBe('grave');
  });

  it('returns the whole level, with its id', () => {
    expect(classifySeverity(0.05, LEVELS)).toEqual(LEVELS[2]);
  });

  it.each([-0.1, 1.01, Number.NaN, Number.POSITIVE_INFINITY])('refuses %s', (ratio) => {
    expect(classifySeverity(ratio, LEVELS)).toBeUndefined();
  });

  it('finds nothing if the table has a hole', () => {
    const withHole = [LEVELS[0]!, LEVELS[2]!];

    expect(classifySeverity(0.02, withHole)).toBeUndefined();
  });

  it('finds nothing without levels', () => {
    expect(classifySeverity(0.02, [])).toBeUndefined();
  });
});

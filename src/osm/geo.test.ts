import { describe, expect, it } from 'vitest';
import { haversineDistance, polylineLength, roundTo } from './geo.js';

describe('haversineDistance', () => {
  it('is zero between the same point', () => {
    expect(haversineDistance([1.2136, -77.2811], [1.2136, -77.2811])).toBe(0);
  });

  it('measures one degree of longitude on the equator (about 111.19 km)', () => {
    expect(haversineDistance([0, 0], [0, 1])).toBeCloseTo(111_195, -1);
  });

  it('measures one degree of latitude (about 111.19 km)', () => {
    expect(haversineDistance([1, -77], [2, -77])).toBeCloseTo(111_195, -1);
  });

  it('is symmetric', () => {
    const a: [number, number] = [1.2136, -77.2811];
    const b: [number, number] = [1.2, -77.25];
    expect(haversineDistance(a, b)).toBeCloseTo(haversineDistance(b, a), 6);
  });

  it('makes a degree of longitude shorter near the poles than at the equator', () => {
    expect(haversineDistance([60, 0], [60, 1])).toBeLessThan(haversineDistance([0, 0], [0, 1]));
  });
});

describe('polylineLength', () => {
  it('is zero for an empty line or a single point', () => {
    expect(polylineLength([])).toBe(0);
    expect(polylineLength([[1, 1]])).toBe(0);
  });

  it('adds the distance of every piece', () => {
    const a: [number, number] = [0, 0];
    const b: [number, number] = [0, 1];
    const c: [number, number] = [1, 1];
    expect(polylineLength([a, b, c])).toBeCloseTo(
      haversineDistance(a, b) + haversineDistance(b, c),
      6,
    );
  });
});

describe('roundTo', () => {
  it('rounds to the given decimals', () => {
    expect(roundTo(1.23456789, 6)).toBe(1.234568);
    expect(roundTo(111.1749, 2)).toBe(111.17);
    expect(roundTo(2.5, 0)).toBe(3);
  });
});

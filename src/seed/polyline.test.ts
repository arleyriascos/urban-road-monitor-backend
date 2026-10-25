import { describe, expect, it } from 'vitest';
import type { LatLon } from '../osm/types.js';
import { midpoint, pointAlong } from './polyline.js';

describe('pointAlong', () => {
  const line: LatLon[] = [
    [0, 0],
    [0, 1],
  ];

  it('returns the ends for fractions 0 and 1', () => {
    expect(pointAlong(line, 0)).toEqual([0, 0]);
    expect(pointAlong(line, 1)).toEqual([0, 1]);
  });

  it('returns the middle of a straight line for 0.5', () => {
    const [lat, lon] = pointAlong(line, 0.5);
    expect(lat).toBeCloseTo(0, 9);
    expect(lon).toBeCloseTo(0.5, 6);
  });

  it('keeps fractions outside 0..1 inside the line', () => {
    expect(pointAlong(line, -3)).toEqual([0, 0]);
    expect(pointAlong(line, 5)).toEqual([0, 1]);
  });

  it('follows the corners of a line made of several pieces', () => {
    const corner: LatLon[] = [
      [0, 0],
      [0, 1],
      [1, 1],
    ];
    const quarter = pointAlong(corner, 0.25);
    const threeQuarters = pointAlong(corner, 0.75);
    expect(quarter[0]).toBeCloseTo(0, 6);
    expect(quarter[1]).toBeCloseTo(0.5, 2);
    expect(threeQuarters[0]).toBeCloseTo(0.5, 2);
    expect(threeQuarters[1]).toBeCloseTo(1, 6);
  });

  it('returns the point itself for a single point or a zero-length line', () => {
    expect(pointAlong([[1.2, -77.2]], 0.5)).toEqual([1.2, -77.2]);
    expect(
      pointAlong(
        [
          [1.2, -77.2],
          [1.2, -77.2],
        ],
        0.5,
      ),
    ).toEqual([1.2, -77.2]);
  });

  it('refuses an empty line', () => {
    expect(() => pointAlong([], 0.5)).toThrow('at least one point');
  });
});

describe('midpoint', () => {
  it('is the point halfway along the line', () => {
    const [lat, lon] = midpoint([
      [1.2, -77.3],
      [1.2, -77.1],
    ]);
    expect(lat).toBeCloseTo(1.2, 9);
    expect(lon).toBeCloseTo(-77.2, 6);
  });
});

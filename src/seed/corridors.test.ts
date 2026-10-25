import { describe, expect, it } from 'vitest';
import { buildGrid, GRID_CENTER } from './__fixtures__/grid.js';
import { CORRIDOR_COUNT, PASTO_CENTER, selectCorridors } from './corridors.js';
import type { SeedSegment } from './types.js';

const grid = buildGrid();

function street(roadId: number, name: string | null, type: string, blocks: number, offset = 0) {
  return Array.from({ length: blocks }, (_unused, i): SeedSegment => ({
    id: roadId * 100 + i,
    roadId,
    roadName: name,
    roadType: type,
    lengthM: 100,
    geometry: [
      [1.2 + offset, -77.28 + i * 0.0009],
      [1.2 + offset, -77.28 + (i + 1) * 0.0009],
    ],
  }));
}

describe('selectCorridors', () => {
  it('chooses 6 corridors in the sample city', () => {
    expect(selectCorridors(grid, GRID_CENTER)).toHaveLength(CORRIDOR_COUNT);
  });

  it('only chooses main roads when there are enough, closest to the center first', () => {
    const corridors = selectCorridors(grid, GRID_CENTER);
    const types = corridors.map((corridor) => corridor.segments[0].roadType);
    expect(types.every((type) => type === 'secondary' || type === 'tertiary')).toBe(true);
    // The four secondary streets are the closest to the center, so all of them are chosen.
    expect(types.filter((type) => type === 'secondary')).toHaveLength(4);
  });

  it('does not repeat street names', () => {
    const names = selectCorridors(grid, GRID_CENTER).map((corridor) => corridor.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('requires several streets nearby as alternatives', () => {
    for (const corridor of selectCorridors(grid, GRID_CENTER)) {
      expect(corridor.alternatives).toBeGreaterThanOrEqual(3);
    }
  });

  it('always gives the same answer', () => {
    expect(selectCorridors(grid, GRID_CENTER)).toEqual(selectCorridors(grid, GRID_CENTER));
  });

  it('returns nothing for an empty network', () => {
    expect(selectCorridors([], GRID_CENTER)).toEqual([]);
  });

  it('skips unnamed streets, short streets and service roads', () => {
    const segments = [
      ...street(1, null, 'primary', 5),
      ...street(2, 'Calle corta', 'primary', 2),
      ...street(3, 'Acceso', 'service', 5),
      ...street(4, 'Calle larga', 'residential', 5),
    ];
    const corridors = selectCorridors(segments, [1.2, -77.2785]);
    expect(corridors.map((corridor) => corridor.name)).toEqual(['Calle larga']);
  });

  it('returns fewer corridors when there are not enough streets', () => {
    const segments = [
      ...street(1, 'Calle A', 'primary', 5),
      ...street(2, 'Calle B', 'secondary', 5, 0.0009),
    ];
    expect(selectCorridors(segments, [1.2, -77.2785])).toHaveLength(2);
  });

  it('uses the middle of the network when the given center is far away', () => {
    const corridors = selectCorridors(grid, [4.7, -74.0]);
    expect(corridors).toHaveLength(CORRIDOR_COUNT);
  });

  it('works without a center', () => {
    expect(selectCorridors(grid, null)).toHaveLength(CORRIDOR_COUNT);
  });

  it('exports the center of Pasto', () => {
    expect(PASTO_CENTER).toEqual([1.2136, -77.2811]);
  });
});

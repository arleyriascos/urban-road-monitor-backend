import { describe, expect, it } from 'vitest';
import { loadSampleResponse } from './__fixtures__/sample.js';
import { parseOverpassResponse } from './parse.js';
import type { OverpassElement } from './types.js';

function way(tags: Record<string, string>, extra: Partial<OverpassElement> = {}): OverpassElement {
  return {
    type: 'way',
    id: 1,
    nodes: [1, 2],
    geometry: [
      { lat: 1, lon: 1 },
      { lat: 1.1, lon: 1.1 },
    ],
    tags: { highway: 'residential', ...tags },
    ...extra,
  };
}

const parseOne = (element: OverpassElement) => parseOverpassResponse({ elements: [element] });

describe('parseOverpassResponse with the sample data', () => {
  const { ways, stats } = parseOverpassResponse(loadSampleResponse());

  it('counts what it read and what it skipped', () => {
    expect(stats).toEqual({
      elementsRead: 10,
      waysRead: 9,
      waysKept: 6,
      skippedType: 1,
      skippedAccess: 1,
      skippedInvalid: 1,
    });
  });

  it('keeps the ways that cars and motorcycles can use', () => {
    expect(ways.map((item) => item.osmWayId)).toEqual([5001, 5002, 5003, 5004, 5005, 5007]);
  });

  it('keeps nodes and coordinates in the same order', () => {
    const calle18 = ways[0];
    expect(calle18.nodeIds).toEqual([1001, 1002, 1003, 1004]);
    expect(calle18.points[1]).toEqual([1.214, -77.281]);
    expect(calle18.name).toBe('Calle 18');
    expect(calle18.highway).toBe('residential');
  });

  it('reads the one-way direction of each way', () => {
    const directions = Object.fromEntries(ways.map((item) => [item.osmWayId, item.oneway]));
    expect(directions).toEqual({
      5001: 'none',
      5002: 'forward',
      5003: 'reverse',
      5004: 'forward',
      5005: 'none',
      5007: 'none',
    });
  });
});

describe('parseOverpassResponse filters', () => {
  it('returns nothing for an empty response', () => {
    const { ways, stats } = parseOverpassResponse({});
    expect(ways).toEqual([]);
    expect(stats.elementsRead).toBe(0);
  });

  it('skips highway values outside the 8 road types', () => {
    expect(parseOne(way({ highway: 'footway' })).stats.skippedType).toBe(1);
    expect(parseOne(way({ highway: 'motorway' })).stats.skippedType).toBe(1);
  });

  it('skips ways without a highway tag', () => {
    expect(parseOne({ ...way({}), tags: {} }).stats.skippedType).toBe(1);
  });

  it.each([
    [{ access: 'no' }],
    [{ access: 'private' }],
    [{ motor_vehicle: 'no' }],
    [{ vehicle: 'private' }],
  ])('skips closed ways: %j', (tags) => {
    const { ways, stats } = parseOne(way(tags));
    expect(ways).toHaveLength(0);
    expect(stats.skippedAccess).toBe(1);
  });

  it.each([
    [{ access: 'no', motor_vehicle: 'yes' }],
    [{ access: 'private', vehicle: 'yes' }],
    [{ access: 'destination' }],
    [{ access: 'customers' }],
    [{ motor_vehicle: 'permissive' }],
  ])('keeps ways open to motor vehicles: %j', (tags) => {
    expect(parseOne(way(tags)).ways).toHaveLength(1);
  });

  it('ignores elements that are not ways but counts them as read', () => {
    const { ways, stats } = parseOverpassResponse({ elements: [{ type: 'node', id: 1 }] });
    expect(ways).toHaveLength(0);
    expect(stats.elementsRead).toBe(1);
    expect(stats.waysRead).toBe(0);
  });
});

describe('parseOverpassResponse invalid geometry', () => {
  it.each([
    ['without nodes', way({}, { nodes: undefined })],
    ['without geometry', way({}, { geometry: undefined })],
    ['with a single node', way({}, { nodes: [1], geometry: [{ lat: 1, lon: 1 }] })],
    ['with different sizes', way({}, { nodes: [1, 2, 3] })],
    ['with a missing point', way({}, { geometry: [{ lat: 1, lon: 1 }, null] })],
    [
      'with a broken coordinate',
      way(
        {},
        {
          geometry: [
            { lat: 1, lon: 1 },
            { lat: Number.NaN, lon: 1 },
          ],
        },
      ),
    ],
  ])('skips a way %s', (_label, element) => {
    const { ways, stats } = parseOne(element);
    expect(ways).toHaveLength(0);
    expect(stats.skippedInvalid).toBe(1);
  });
});

describe('parseOverpassResponse names', () => {
  it('uses the name of the street', () => {
    expect(parseOne(way({ name: 'Calle 18', ref: 'N25' })).ways[0].name).toBe('Calle 18');
  });

  it('falls back to the reference when there is no name', () => {
    expect(parseOne(way({ ref: 'N25' })).ways[0].name).toBe('N25');
  });

  it('uses null when there is no name or the name is blank', () => {
    expect(parseOne(way({})).ways[0].name).toBeNull();
    expect(parseOne(way({ name: '   ' })).ways[0].name).toBeNull();
  });

  it('cuts names to the 200 characters the database accepts', () => {
    expect(parseOne(way({ name: 'a'.repeat(300) })).ways[0].name).toHaveLength(200);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { RoadSearchIndex, type RoadPlace } from './road-search-index.js';

function road(
  roadId: number,
  name: string | null,
  lat: number,
  lon: number,
  segments = 2,
): RoadPlace {
  return {
    roadId,
    name,
    segments,
    minLatitude: lat,
    maxLatitude: lat + 0.002,
    minLongitude: lon,
    maxLongitude: lon + 0.004,
  };
}

describe('RoadSearchIndex', () => {
  let index: RoadSearchIndex;

  beforeEach(() => {
    index = new RoadSearchIndex();
    index.build([
      road(1, 'Calle 18', 1.2, -77.3),
      road(2, 'Calle 18', 1.21, -77.29, 3), // another way of the same street
      road(3, 'Carrera 9', 1.22, -77.28),
      road(4, 'Avenida Panamericana', 1.23, -77.27),
      road(5, 'Calle 5 Sur', 1.24, -77.26),
      road(6, null, 1.25, -77.25),
      road(7, '   ', 1.26, -77.24),
      road(8, 'Calle del Cañón', 1.27, -77.23),
    ]);
  });

  it('counts each street once, whatever the number of ways, and skips the ones without name', () => {
    expect(index.size).toBe(5);
  });

  it('finds streets by the beginning of the name', () => {
    expect(index.search('cal').map((m) => m.name)).toEqual([
      'Calle 18',
      'Calle 5 Sur',
      'Calle del Cañón',
    ]);
  });

  it('ignores accents, capitals and extra spaces in what was typed', () => {
    expect(index.search('  CALLE   DEL  canón ').map((m) => m.name)).toEqual(['Calle del Cañón']);
    expect(index.search('calle del canon')).toHaveLength(1);
  });

  it('joins the ways of one street: ids, segments and the box that holds them all', () => {
    const [match] = index.search('calle 18');
    expect(match).toEqual({
      name: 'Calle 18',
      roadIds: [1, 2],
      segments: 5,
      center: { latitude: 1.2 + (1.212 - 1.2) / 2, longitude: -77.3 + (-77.286 + 77.3) / 2 },
      bounds: { minLatitude: 1.2, maxLatitude: 1.212, minLongitude: -77.3, maxLongitude: -77.286 },
    });
  });

  it('also finds a street by a later word, after the ones that start with it', () => {
    index.build([
      road(1, 'Calle 18', 1, 1),
      road(2, '18 de Octubre', 2, 2),
      road(3, 'Plaza 18', 3, 3),
    ]);
    expect(index.search('18').map((m) => m.name)).toEqual([
      '18 de Octubre',
      'Calle 18',
      'Plaza 18',
    ]);
  });

  it('does not repeat a street that matches by name and by word', () => {
    index.build([road(1, 'Sur Sur', 1, 1)]);
    expect(index.search('sur')).toHaveLength(1);
  });

  it('respects the limit and answers nothing for an empty query or limit', () => {
    expect(index.search('c', 2)).toHaveLength(2);
    expect(index.search('')).toEqual([]);
    expect(index.search('   ')).toEqual([]);
    expect(index.search('c', 0)).toEqual([]);
    expect(index.search('zzz')).toEqual([]);
  });

  it('gives the same answer whatever the order the roads came in', () => {
    const other = new RoadSearchIndex();
    other.build([
      road(8, 'Calle del Cañón', 1.27, -77.23),
      road(2, 'Calle 18', 1.21, -77.29, 3),
      road(5, 'Calle 5 Sur', 1.24, -77.26),
      road(1, 'Calle 18', 1.2, -77.3),
    ]);
    expect(other.search('calle').map((m) => m.name)).toEqual([
      'Calle 18',
      'Calle 5 Sur',
      'Calle del Cañón',
    ]);
    expect(other.search('calle 18')[0]?.roadIds).toEqual([1, 2]);
  });

  it('replaces what it knew when built again', () => {
    index.build([road(9, 'Plaza Nariño', 1, 1)]);
    expect(index.search('calle')).toEqual([]);
    expect(index.search('plaza')).toHaveLength(1);
  });

  it('returns copies, so the caller cannot change the index', () => {
    index.search('calle 18')[0]!.roadIds.push(99);
    expect(index.search('calle 18')[0]!.roadIds).toEqual([1, 2]);
  });
});

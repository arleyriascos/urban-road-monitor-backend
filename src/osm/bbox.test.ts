import { describe, expect, it } from 'vitest';
import { boundingBoxKey, formatBoundingBox, parseBoundingBox } from './bbox.js';

describe('parseBoundingBox', () => {
  it('reads south,west,north,east and ignores spaces', () => {
    expect(parseBoundingBox(' 1.17, -77.32 ,1.25,-77.24')).toEqual({
      south: 1.17,
      west: -77.32,
      north: 1.25,
      east: -77.24,
    });
  });

  it.each(['1,2,3', '1,2,3,4,5', '1,2,3,', ''])(
    'rejects the wrong amount of values: "%s"',
    (text) => {
      expect(() => parseBoundingBox(text)).toThrow('4 números');
    },
  );

  it('rejects values that are not numbers', () => {
    expect(() => parseBoundingBox('1,2,tres,4')).toThrow('solo puede contener números');
  });

  it('rejects a south value that is not below the north value', () => {
    expect(() => parseBoundingBox('2,-77,1,-76')).toThrow('sur debe ser menor');
  });

  it('rejects a west value that is not below the east value', () => {
    expect(() => parseBoundingBox('1,-76,2,-77')).toThrow('oeste debe ser menor');
  });

  it('rejects latitudes and longitudes out of range', () => {
    expect(() => parseBoundingBox('-91,0,1,1')).toThrow('latitud');
    expect(() => parseBoundingBox('0,0,91,1')).toThrow('latitud');
    expect(() => parseBoundingBox('0,-181,1,1')).toThrow('longitud');
    expect(() => parseBoundingBox('0,0,1,181')).toThrow('longitud');
  });
});

describe('formatBoundingBox and boundingBoxKey', () => {
  const bbox = { south: 1.17, west: -77.32, north: 1.25, east: -77.24 };

  it('describes the rectangle in Spanish', () => {
    expect(formatBoundingBox(bbox)).toBe('sur 1.17, oeste -77.32, norte 1.25, este -77.24');
  });

  it('builds a stable key for the cache file name', () => {
    expect(boundingBoxKey(bbox)).toBe('1.17_-77.32_1.25_-77.24');
  });
});

import { describe, expect, it } from 'vitest';
import { featureCollection, lineStringFeature, pointFeature, toPosition } from './mappers.js';

describe('toPosition', () => {
  it('swaps [latitude, longitude] into the GeoJSON order [longitude, latitude]', () => {
    expect(toPosition([1.2136, -77.2811])).toEqual([-77.2811, 1.2136]);
  });
});

describe('lineStringFeature', () => {
  it('builds a LineString with every point swapped and keeps id and properties', () => {
    const feature = lineStringFeature(
      7,
      [
        [1.2, -77.2],
        [1.3, -77.3],
      ],
      { name: 'Calle 18' },
    );
    expect(feature).toEqual({
      type: 'Feature',
      id: 7,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-77.2, 1.2],
          [-77.3, 1.3],
        ],
      },
      properties: { name: 'Calle 18' },
    });
  });
});

describe('pointFeature', () => {
  it('builds a Point with the position as [longitude, latitude]', () => {
    const feature = pointFeature('abc', 1.2136, -77.2811, { severity: 'grave' });
    expect(feature.geometry).toEqual({ type: 'Point', coordinates: [-77.2811, 1.2136] });
    expect(feature.id).toBe('abc');
    expect(feature.properties).toEqual({ severity: 'grave' });
  });
});

describe('featureCollection', () => {
  it('wraps the features', () => {
    const feature = pointFeature(1, 1, 1, {});
    expect(featureCollection([feature])).toEqual({
      type: 'FeatureCollection',
      features: [feature],
    });
  });

  it('accepts an empty list', () => {
    expect(featureCollection([])).toEqual({ type: 'FeatureCollection', features: [] });
  });
});

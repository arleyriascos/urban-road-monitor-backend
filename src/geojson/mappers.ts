import type { LatLon } from '../osm/types.js';
import type {
  Feature,
  FeatureCollection,
  LineStringGeometry,
  PointGeometry,
  Position,
} from './types.js';

/** [latitude, longitude] (how the database stores points) -> [longitude, latitude] (GeoJSON). */
export function toPosition([latitude, longitude]: LatLon): Position {
  return [longitude, latitude];
}

export function lineStringFeature<P>(
  id: number | string,
  points: readonly LatLon[],
  properties: P,
): Feature<LineStringGeometry, P> {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'LineString', coordinates: points.map(toPosition) },
    properties,
  };
}

export function pointFeature<P>(
  id: number | string,
  latitude: number,
  longitude: number,
  properties: P,
): Feature<PointGeometry, P> {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: toPosition([latitude, longitude]) },
    properties,
  };
}

export function featureCollection<G, P>(features: Feature<G, P>[]): FeatureCollection<G, P> {
  return { type: 'FeatureCollection', features };
}

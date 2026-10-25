/** GeoJSON (RFC 7946) uses [longitude, latitude], the opposite of how we store points. */
export type Position = [longitude: number, latitude: number];

export interface LineStringGeometry {
  type: 'LineString';
  coordinates: Position[];
}

export interface PointGeometry {
  type: 'Point';
  coordinates: Position;
}

export interface Feature<G, P> {
  type: 'Feature';
  id: number | string;
  geometry: G;
  properties: P;
}

export interface FeatureCollection<G, P> {
  type: 'FeatureCollection';
  features: Feature<G, P>[];
}

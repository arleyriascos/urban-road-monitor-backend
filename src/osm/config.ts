/** Rectangle on the map, in decimal degrees (WGS84). */
export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Initial rectangle around the urban area of Pasto (Nariño).
 * It is an approximation: adjust it with --bbox after looking at the result on the map.
 * Ways that cross the border are imported complete, so a few streets may extend past it.
 */
export const DEFAULT_BBOX: BoundingBox = {
  south: 1.17,
  west: -77.32,
  north: 1.25,
  east: -77.24,
};

/** The 8 OpenStreetMap "highway" values stored in the road_types catalog. */
export const ROAD_TYPE_TAGS = [
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'living_street',
  'service',
  'unclassified',
] as const;

export type RoadTypeTag = (typeof ROAD_TYPE_TAGS)[number];

/** Access values that mean "cars and motorcycles cannot use this way". */
export const BLOCKED_ACCESS_VALUES: readonly string[] = ['no', 'private'];

/** Public Overpass API servers, tried in turn when one of them is busy. */
export const OVERPASS_ENDPOINTS: readonly string[] = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export const OVERPASS_QUERY_TIMEOUT_SECONDS = 180;

export const OVERPASS_USER_AGENT =
  'urban-road-monitor-importer/0.1 (university project, Pasto, Colombia)';

/** Folder (ignored by Git) where the downloaded OpenStreetMap data is kept. */
export const CACHE_DIRECTORY = 'data/osm';

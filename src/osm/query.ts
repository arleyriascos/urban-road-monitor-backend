import { OVERPASS_QUERY_TIMEOUT_SECONDS, ROAD_TYPE_TAGS, type BoundingBox } from './config.js';

/**
 * Overpass QL query: every way inside the rectangle whose "highway" tag is one of
 * the 8 road types. "out geom" returns, for each way, its node ids and coordinates.
 */
export function buildOverpassQuery(
  bbox: BoundingBox,
  timeoutSeconds: number = OVERPASS_QUERY_TIMEOUT_SECONDS,
): string {
  const types = ROAD_TYPE_TAGS.join('|');
  const area = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;

  return [
    `[out:json][timeout:${timeoutSeconds}];`,
    `way["highway"~"^(${types})$"](${area});`,
    'out geom;',
  ].join('\n');
}

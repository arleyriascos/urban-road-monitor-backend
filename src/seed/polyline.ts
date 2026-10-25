import { haversineDistance, polylineLength } from '../osm/geo.js';
import type { LatLon } from '../osm/types.js';

/**
 * The point that is `fraction` (0 to 1) of the way along a line, measured by distance.
 * Over a street segment (tens of meters) a straight interpolation of the coordinates
 * is accurate enough.
 */
export function pointAlong(points: readonly LatLon[], fraction: number): LatLon {
  if (points.length === 0) throw new Error('A line needs at least one point');

  const total = polylineLength(points);
  if (points.length === 1 || total === 0) return points[0];

  const target = total * Math.min(1, Math.max(0, fraction));
  let walked = 0;

  for (let i = 1; i < points.length; i++) {
    const piece = haversineDistance(points[i - 1], points[i]);
    if (walked + piece >= target && piece > 0) {
      const t = (target - walked) / piece;
      const [lat1, lon1] = points[i - 1];
      const [lat2, lon2] = points[i];
      return [lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t];
    }
    walked += piece;
  }

  return points[points.length - 1];
}

export function midpoint(points: readonly LatLon[]): LatLon {
  return pointAlong(points, 0.5);
}

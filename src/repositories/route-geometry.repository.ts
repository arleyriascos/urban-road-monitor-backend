import { prisma } from '../config/database.js';
import type { LatLon } from '../osm/types.js';

/** What a route needs to draw one of its segments. */
export interface RouteSegmentRow {
  id: number;
  roadName: string | null;
  /** Points as the database stores them: [latitude, longitude], in the segment's order. */
  geometry: LatLon[];
}

interface RawRouteSegmentRow {
  id: bigint;
  road_name: string | null;
  geometry: LatLon[];
}

/** Reads the drawing and the street name of the segments of a route. It only reads. */
export class RouteGeometryRepository {
  async findSegments(ids: readonly number[]): Promise<RouteSegmentRow[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await prisma.$queryRaw<RawRouteSegmentRow[]>`
      SELECT s.id, r.name AS road_name, s.geometry
      FROM road_segments s
      JOIN roads r ON r.id = s.road_id
      WHERE s.id = ANY(${[...ids]}::bigint[])`;

    return rows.map((row) => ({
      id: Number(row.id),
      roadName: row.road_name,
      geometry: row.geometry,
    }));
  }
}

export const routeGeometryRepository = new RouteGeometryRepository();

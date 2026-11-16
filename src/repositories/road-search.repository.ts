import { prisma } from '../config/database.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { RoadPlace } from '../roads/road-search-index.js';

interface RawPlace {
  road_id: bigint;
  name: string;
  segments: number;
  min_lat: number;
  max_lat: number;
  min_lon: number;
  max_lon: number;
}

/** Reads the streets that have a name, with the box that contains each one. */
export class RoadSearchRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async findAll(): Promise<RoadPlace[]> {
    const rows = await this.db.$queryRaw<RawPlace[]>`
      SELECT r.id AS road_id,
             r.name,
             COUNT(DISTINCT rs.id)::int AS segments,
             MIN(LEAST(a.latitude, b.latitude))::float8 AS min_lat,
             MAX(GREATEST(a.latitude, b.latitude))::float8 AS max_lat,
             MIN(LEAST(a.longitude, b.longitude))::float8 AS min_lon,
             MAX(GREATEST(a.longitude, b.longitude))::float8 AS max_lon
      FROM roads r
      JOIN road_segments rs ON rs.road_id = r.id
      JOIN road_nodes a ON a.id = rs.from_node_id
      JOIN road_nodes b ON b.id = rs.to_node_id
      WHERE r.name IS NOT NULL AND btrim(r.name) <> ''
      GROUP BY r.id, r.name
      ORDER BY r.id`;

    return rows.map((row) => ({
      roadId: Number(row.road_id),
      name: row.name,
      segments: row.segments,
      minLatitude: row.min_lat,
      maxLatitude: row.max_lat,
      minLongitude: row.min_lon,
      maxLongitude: row.max_lon,
    }));
  }

  /** Changes whenever a road or a segment is added or removed (the streets are only imported). */
  async findStamp(): Promise<string> {
    const [row] = await this.db.$queryRaw<{ stamp: string }[]>`
      SELECT concat_ws(
        '|',
        (SELECT COUNT(*) FROM roads),
        (SELECT COALESCE(MAX(imported_at)::text, '') FROM roads),
        (SELECT COUNT(*) FROM road_segments)
      ) AS stamp`;
    return row?.stamp ?? '';
  }
}

export const roadSearchRepository = new RoadSearchRepository();

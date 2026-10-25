import { describeDatabaseTarget } from '../config/database-target.js';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { ROAD_TYPE_TAGS } from '../osm/config.js';
import type { SaveSummary } from '../osm/report.js';
import type { NetworkDraft } from '../osm/types.js';
import { Prisma } from '../generated/prisma/client.js';
import type { RoadNetworkStore, TargetDescription } from '../services/road-import.service.js';

const CHUNK_SIZE = 2_000;
const TRANSACTION_TIMEOUT_MS = 15 * 60 * 1000;

interface UpsertRow {
  inserted: boolean;
}

interface NodeRow extends UpsertRow {
  id: bigint;
  osm_node_id: bigint;
}

interface RoadRow extends UpsertRow {
  id: bigint;
  osm_way_id: bigint;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function countRows(rows: readonly UpsertRow[]): { inserted: number; updated: number } {
  const inserted = rows.filter((row) => row.inserted).length;
  return { inserted, updated: rows.length - inserted };
}

function add(
  total: { inserted: number; updated: number },
  part: { inserted: number; updated: number },
): void {
  total.inserted += part.inserted;
  total.updated += part.updated;
}

/**
 * Saves the road network in PostgreSQL. Each batch is sent as ONE JSON parameter and
 * expanded with jsonb_to_recordset, so thousands of rows travel in a single query.
 * "xmax = 0" is true only for rows that were inserted (not updated).
 * Everything runs in one transaction: if something fails, nothing is saved.
 */
export class RoadNetworkRepository implements RoadNetworkStore {
  constructor(private readonly databaseUrl: string = env.DATABASE_URL) {}

  describeTarget(): TargetDescription {
    return describeDatabaseTarget(this.databaseUrl);
  }

  async save(network: NetworkDraft): Promise<SaveSummary> {
    return prisma.$transaction(
      async (tx) => {
        const roadTypeIds = await this.loadRoadTypeIds(tx);
        const nodeIds = await this.upsertNodes(tx, network);
        const roads = await this.upsertRoads(tx, network, roadTypeIds);
        const segments = await this.upsertSegments(tx, network, nodeIds, roads.ids);
        const stale = await this.removeStaleSegments(tx, network, roads.ids);

        return {
          nodes: nodeIds.counts,
          roads: roads.counts,
          segments,
          staleSegmentsDeleted: stale.deleted,
          staleSegmentsKept: stale.kept,
        };
      },
      { timeout: TRANSACTION_TIMEOUT_MS, maxWait: 60_000 },
    );
  }

  /** osm_highway_tag -> id, checking that the 8 road types exist in the catalog. */
  private async loadRoadTypeIds(tx: Prisma.TransactionClient): Promise<Map<string, number>> {
    const rows = await tx.$queryRaw<{ id: number; osm_highway_tag: string }[]>`
      SELECT id, osm_highway_tag FROM road_types`;
    const ids = new Map(rows.map((row) => [row.osm_highway_tag, Number(row.id)]));

    const missing = ROAD_TYPE_TAGS.filter((tag) => !ids.has(tag));
    if (missing.length > 0) {
      throw new Error(
        `Faltan tipos de vía en el catálogo road_types: ${missing.join(', ')}. ` +
          'Ejecuta los scripts de la carpeta database/ antes de importar.',
      );
    }
    return ids;
  }

  private async upsertNodes(
    tx: Prisma.TransactionClient,
    network: NetworkDraft,
  ): Promise<{ ids: Map<number, number>; counts: { inserted: number; updated: number } }> {
    const ids = new Map<number, number>();
    const counts = { inserted: 0, updated: 0 };

    for (const part of chunk(network.nodes, CHUNK_SIZE)) {
      const json = JSON.stringify(
        part.map((node) => ({
          osm_node_id: node.osmNodeId,
          latitude: node.latitude,
          longitude: node.longitude,
        })),
      );
      const rows = await tx.$queryRaw<NodeRow[]>`
        INSERT INTO road_nodes (osm_node_id, latitude, longitude)
        SELECT r.osm_node_id, r.latitude, r.longitude
        FROM jsonb_to_recordset(${json}::jsonb)
          AS r(osm_node_id bigint, latitude numeric, longitude numeric)
        ON CONFLICT (osm_node_id) DO UPDATE
          SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude
        RETURNING id, osm_node_id, (xmax = 0) AS inserted`;

      for (const row of rows) ids.set(Number(row.osm_node_id), Number(row.id));
      add(counts, countRows(rows));
    }
    return { ids, counts };
  }

  private async upsertRoads(
    tx: Prisma.TransactionClient,
    network: NetworkDraft,
    roadTypeIds: ReadonlyMap<string, number>,
  ): Promise<{ ids: Map<number, number>; counts: { inserted: number; updated: number } }> {
    const ids = new Map<number, number>();
    const counts = { inserted: 0, updated: 0 };

    for (const part of chunk(network.roads, CHUNK_SIZE)) {
      const json = JSON.stringify(
        part.map((road) => ({
          road_type_id: roadTypeIds.get(road.highway),
          osm_way_id: road.osmWayId,
          name: road.name,
          total_length_m: road.totalLengthM,
        })),
      );
      const rows = await tx.$queryRaw<RoadRow[]>`
        INSERT INTO roads (road_type_id, osm_way_id, name, total_length_m)
        SELECT r.road_type_id, r.osm_way_id, r.name, r.total_length_m
        FROM jsonb_to_recordset(${json}::jsonb)
          AS r(road_type_id int, osm_way_id bigint, name text, total_length_m numeric)
        ON CONFLICT (osm_way_id) DO UPDATE
          SET road_type_id = EXCLUDED.road_type_id,
              name = EXCLUDED.name,
              total_length_m = EXCLUDED.total_length_m,
              imported_at = NOW()
        RETURNING id, osm_way_id, (xmax = 0) AS inserted`;

      for (const row of rows) ids.set(Number(row.osm_way_id), Number(row.id));
      add(counts, countRows(rows));
    }
    return { ids, counts };
  }

  /**
   * Segments are identified by (road, index). Damage columns (damage_score,
   * max_severity_level_id) are never touched, so a re-import keeps the potholes' effect.
   */
  private async upsertSegments(
    tx: Prisma.TransactionClient,
    network: NetworkDraft,
    nodeIds: { ids: Map<number, number> },
    roadIds: ReadonlyMap<number, number>,
  ): Promise<{ inserted: number; updated: number }> {
    const counts = { inserted: 0, updated: 0 };
    const rows = network.roads.flatMap((road) =>
      road.segments.map((segment) => ({
        road_id: roadIds.get(road.osmWayId),
        from_node_id: nodeIds.ids.get(segment.fromOsmNodeId),
        to_node_id: nodeIds.ids.get(segment.toOsmNodeId),
        segment_index: segment.index,
        length_m: segment.lengthM,
        is_oneway: segment.isOneway,
        geometry: segment.geometry,
      })),
    );

    for (const part of chunk(rows, CHUNK_SIZE)) {
      const json = JSON.stringify(part);
      const result = await tx.$queryRaw<UpsertRow[]>`
        INSERT INTO road_segments
          (road_id, from_node_id, to_node_id, segment_index, length_m, is_oneway, geometry)
        SELECT r.road_id, r.from_node_id, r.to_node_id, r.segment_index,
               r.length_m, r.is_oneway, r.geometry
        FROM jsonb_to_recordset(${json}::jsonb)
          AS r(road_id bigint, from_node_id bigint, to_node_id bigint, segment_index int,
               length_m numeric, is_oneway boolean, geometry jsonb)
        ON CONFLICT (road_id, segment_index) DO UPDATE
          SET from_node_id = EXCLUDED.from_node_id,
              to_node_id = EXCLUDED.to_node_id,
              length_m = EXCLUDED.length_m,
              is_oneway = EXCLUDED.is_oneway,
              geometry = EXCLUDED.geometry
        RETURNING (xmax = 0) AS inserted`;

      add(counts, countRows(result));
    }
    return counts;
  }

  /**
   * If a road now has fewer segments than before, the extra old ones are deleted,
   * except those that have potholes or are part of a saved route.
   */
  private async removeStaleSegments(
    tx: Prisma.TransactionClient,
    network: NetworkDraft,
    roadIds: ReadonlyMap<number, number>,
  ): Promise<{ deleted: number; kept: number }> {
    let deleted = 0;
    let kept = 0;
    const counts = network.roads.map((road) => ({
      road_id: roadIds.get(road.osmWayId),
      segment_count: road.segments.length,
    }));

    for (const part of chunk(counts, CHUNK_SIZE)) {
      const json = JSON.stringify(part);

      deleted += await tx.$executeRaw`
        DELETE FROM road_segments rs
        USING jsonb_to_recordset(${json}::jsonb) AS c(road_id bigint, segment_count int)
        WHERE rs.road_id = c.road_id
          AND rs.segment_index >= c.segment_count
          AND NOT EXISTS (SELECT 1 FROM potholes p WHERE p.road_segment_id = rs.id)
          AND NOT EXISTS (SELECT 1 FROM route_steps s WHERE s.road_segment_id = rs.id)`;

      const remaining = await tx.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) AS total
        FROM road_segments rs
        JOIN jsonb_to_recordset(${json}::jsonb) AS c(road_id bigint, segment_count int)
          ON rs.road_id = c.road_id AND rs.segment_index >= c.segment_count`;
      kept += Number(remaining[0].total);
    }
    return { deleted, kept };
  }
}

import { prisma } from '../config/database.js';
import { Prisma } from '../generated/prisma/client.js';

/** An intersection of the road graph, as the AI service needs it. */
export interface GraphNodeRow {
  id: number;
  latitude: number;
  longitude: number;
}

/** A road segment of the road graph, as the AI service needs it. */
export interface GraphSegmentRow {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  lengthM: number;
  damageScore: number;
  isOneway: boolean;
}

/** The whole road graph read from one consistent view of the database. */
export interface RoadGraphSnapshot {
  /** Fingerprint of exactly these nodes and segments (see GRAPH_VERSION_SQL). */
  version: string;
  /** Only the nodes that some segment uses, ordered by id. */
  nodes: GraphNodeRow[];
  /** Every segment, ordered by id. */
  segments: GraphSegmentRow[];
}

interface RawNodeRow {
  id: bigint;
  latitude: number;
  longitude: number;
}

interface RawSegmentRow {
  id: bigint;
  from_node_id: bigint;
  to_node_id: bigint;
  length_m: number;
  damage_score: number;
  is_oneway: boolean;
}

const SNAPSHOT_TIMEOUT_MS = 20_000;

/**
 * Version of the road graph: an MD5 of the data the graph uses, in id order.
 * It changes if and only if a node or a segment of the graph changes (ids, ends,
 * length, damage, one-way, coordinates). Changes the graph does not use, such as
 * the geometry or the severity, leave it as it is.
 *
 * It does not rely on updated_at: NOW() is the start time of a transaction, so a long
 * transaction that commits after a short one could leave max(updated_at) unchanged.
 */
const GRAPH_VERSION_SQL = Prisma.sql`
  SELECT md5(
    COALESCE((
      SELECT string_agg(
               concat_ws(':', s.id, s.from_node_id, s.to_node_id, s.length_m, s.damage_score, s.is_oneway),
               ',' ORDER BY s.id)
      FROM road_segments s), '')
    || '|' ||
    COALESCE((
      SELECT string_agg(concat_ws(':', n.id, n.latitude, n.longitude), ',' ORDER BY n.id)
      FROM road_nodes n
      WHERE EXISTS (SELECT 1 FROM road_segments s WHERE s.from_node_id = n.id)
         OR EXISTS (SELECT 1 FROM road_segments s WHERE s.to_node_id = n.id)), '')
  ) AS version`;

/** Reads the road graph for the AI service. It only reads: it never changes the database. */
export class RoadGraphRepository {
  /**
   * Version, nodes and segments in one read-only REPEATABLE READ transaction, so the three
   * come from the same view of the database even if an import or a damage update runs
   * at the same time. Without it a segment could point to a node missing from the list.
   */
  async getSnapshot(): Promise<RoadGraphSnapshot> {
    return prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const [versionRow] = await tx.$queryRaw<{ version: string }[]>(GRAPH_VERSION_SQL);
        // numeric and bigint columns are cast so they arrive as plain JavaScript numbers.
        const nodes = await tx.$queryRaw<RawNodeRow[]>`
          SELECT n.id, n.latitude::float8 AS latitude, n.longitude::float8 AS longitude
          FROM road_nodes n
          WHERE EXISTS (SELECT 1 FROM road_segments s WHERE s.from_node_id = n.id)
             OR EXISTS (SELECT 1 FROM road_segments s WHERE s.to_node_id = n.id)
          ORDER BY n.id`;
        const segments = await tx.$queryRaw<RawSegmentRow[]>`
          SELECT id, from_node_id, to_node_id,
                 length_m::float8 AS length_m, damage_score::float8 AS damage_score, is_oneway
          FROM road_segments
          ORDER BY id`;

        return {
          version: versionRow.version,
          nodes: nodes.map((row) => ({
            id: Number(row.id),
            latitude: row.latitude,
            longitude: row.longitude,
          })),
          segments: segments.map((row) => ({
            id: Number(row.id),
            fromNodeId: Number(row.from_node_id),
            toNodeId: Number(row.to_node_id),
            lengthM: row.length_m,
            damageScore: row.damage_score,
            isOneway: row.is_oneway,
          })),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: SNAPSHOT_TIMEOUT_MS,
        maxWait: SNAPSHOT_TIMEOUT_MS,
      },
    );
  }

  /** Only the version, in a single statement (one statement always sees one view). */
  async getVersion(): Promise<string> {
    const [row] = await prisma.$queryRaw<{ version: string }[]>(GRAPH_VERSION_SQL);
    return row.version;
  }
}

export const roadGraphRepository = new RoadGraphRepository();

import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * Roads for the tests that need a real PostgreSQL. Every id is far above any real one, so the
 * rows are told apart and removed afterwards (see removeFixtureRoads).
 */
const BASE = 900_000_000_000n;

export interface FixtureRoad {
  roadId: number;
  /** The segments in order, from segment_index 0. */
  segmentIds: number[];
}

/**
 * A straight street of `segments` segments of 100 m, going north from latitude 1.2. `slot` makes
 * the ids of one street different from those of another (use 0, 1, 2...).
 */
export async function insertFixtureRoad(
  db: PrismaClient,
  slot: number,
  name: string | null,
  segments: number,
): Promise<FixtureRoad> {
  const base = BASE + BigInt(slot) * 1000n;
  const [type] = await db.$queryRawUnsafe<{ id: number }[]>('SELECT id FROM road_types LIMIT 1');
  await db.$executeRawUnsafe(
    `INSERT INTO roads (id, road_type_id, osm_way_id, name)
     VALUES (${base}, ${type!.id}, ${base}, ${name === null ? 'NULL' : `'${name.replace(/'/g, "''")}'`})`,
  );
  const step = 0.0009; // about 100 m of latitude
  const segmentIds: number[] = [];
  for (let i = 0; i < segments; i++) {
    const from = base + BigInt(i);
    const to = base + BigInt(i + 1);
    const lat = (n: number) => (1.2 + (slot * 0.05 + n * step)).toFixed(6);
    for (const [id, n] of [
      [from, i],
      [to, i + 1],
    ] as const) {
      await db.$executeRawUnsafe(
        `INSERT INTO road_nodes (id, osm_node_id, latitude, longitude)
         VALUES (${id}, ${id}, ${lat(n)}, -77.28) ON CONFLICT (id) DO NOTHING`,
      );
    }
    await db.$executeRawUnsafe(
      `INSERT INTO road_segments (id, road_id, from_node_id, to_node_id, segment_index, length_m, geometry)
       VALUES (${from}, ${base}, ${from}, ${to}, ${i}, 100, '[[${lat(i)}, -77.28], [${lat(i + 1)}, -77.28]]'::jsonb)`,
    );
    segmentIds.push(Number(from));
  }
  return { roadId: Number(base), segmentIds };
}

/** Removes every road, node and segment the fixtures made (and the potholes on them). */
export async function removeFixtureRoads(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(`DELETE FROM potholes WHERE road_segment_id >= ${BASE}`);
  await db.$executeRawUnsafe(`DELETE FROM road_segments WHERE id >= ${BASE}`);
  await db.$executeRawUnsafe(`DELETE FROM roads WHERE id >= ${BASE}`);
  await db.$executeRawUnsafe(`DELETE FROM road_nodes WHERE id >= ${BASE}`);
}

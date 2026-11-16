import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createTestClient, testDatabaseUrl } from '../test/test-database.js';
import { RoadGraphRepository } from './road-graph.repository.js';

/** The road graph as the AI service reads it, against a real PostgreSQL. */
const url = testDatabaseUrl();

// Rows of this test live far from any real id, so they are told apart and removed afterwards.
const BASE = 900_000_000_000n;

describe.skipIf(!url)('RoadGraphRepository (real database)', () => {
  let db: PrismaClient;
  let repository: RoadGraphRepository;

  beforeAll(() => {
    db = createTestClient(url!);
    repository = new RoadGraphRepository(db);
  });

  afterEach(async () => {
    await db.$executeRawUnsafe(`DELETE FROM road_segments WHERE id >= ${BASE}`);
    await db.$executeRawUnsafe(`DELETE FROM roads WHERE id >= ${BASE}`);
    await db.$executeRawUnsafe(`DELETE FROM road_nodes WHERE id >= ${BASE}`);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function insertSegment(geometry: [number, number][]) {
    const [type] = await db.$queryRawUnsafe<{ id: number }[]>('SELECT id FROM road_types LIMIT 1');
    await db.$executeRawUnsafe(
      `INSERT INTO road_nodes (id, osm_node_id, latitude, longitude) VALUES
         (${BASE}, ${BASE}, 1.2136, -77.2811), (${BASE + 1n}, ${BASE + 1n}, 1.2146, -77.2801)`,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO roads (id, road_type_id, osm_way_id, name) VALUES (${BASE}, ${type!.id}, ${BASE}, 'Calle de prueba')`,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO road_segments (id, road_id, from_node_id, to_node_id, segment_index, length_m, geometry)
       VALUES (${BASE}, ${BASE}, ${BASE}, ${BASE + 1n}, 0, 150.5, '${JSON.stringify(geometry)}'::jsonb)`,
    );
  }

  const ours = async () =>
    (await repository.getSnapshot()).segments.find((segment) => segment.id === Number(BASE));

  it('gives the drawn shape of every segment, from end to end', async () => {
    const shape: [number, number][] = [
      [1.2136, -77.2811],
      [1.2141, -77.2806],
      [1.2146, -77.2801],
    ];
    await insertSegment(shape);

    expect(await ours()).toMatchObject({
      fromNodeId: Number(BASE),
      toNodeId: Number(BASE + 1n),
      lengthM: 150.5,
      geometry: shape,
    });
  });

  it('changes the version when only the shape of a segment changes', async () => {
    await insertSegment([
      [1.2136, -77.2811],
      [1.2146, -77.2801],
    ]);
    const before = await repository.getVersion();

    await db.$executeRawUnsafe(
      `UPDATE road_segments SET geometry = '[[1.2136,-77.2811],[1.2141,-77.2806],[1.2146,-77.2801]]'::jsonb WHERE id = ${BASE}`,
    );

    expect(await repository.getVersion()).not.toBe(before);
  });

  it('answers the same version to the version query and to the snapshot', async () => {
    await insertSegment([
      [1.2136, -77.2811],
      [1.2146, -77.2801],
    ]);

    expect((await repository.getSnapshot()).version).toBe(await repository.getVersion());
  });
});

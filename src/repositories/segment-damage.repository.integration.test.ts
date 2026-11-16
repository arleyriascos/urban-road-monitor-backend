import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { insertFixtureRoad, removeFixtureRoads, type FixtureRoad } from '../test/road-fixture.js';
import { createTestClient, testDatabaseUrl } from '../test/test-database.js';
import { SegmentDamageRepository } from './segment-damage.repository.js';

/** The damage of a segment, from its potholes, against a real PostgreSQL. */
const url = testDatabaseUrl();
const T = '2026-11-10T10:00:00Z';

describe.skipIf(!url)('SegmentDamageRepository (real database)', () => {
  let db: PrismaClient;
  let repository: SegmentDamageRepository;
  let road: FixtureRoad;
  let severity: Record<string, number>;
  let status: Record<string, number>;

  beforeAll(async () => {
    db = createTestClient(url!);
    repository = new SegmentDamageRepository(db);
    severity = Object.fromEntries(
      (await db.severity_levels.findMany()).map((level) => [level.name, level.id]),
    );
    status = Object.fromEntries(
      (await db.pothole_statuses.findMany()).map((item) => [item.name, item.id]),
    );
  });

  beforeEach(async () => {
    await removeFixtureRoads(db);
    road = await insertFixtureRoad(db, 0, 'Calle 1', 2);
  });

  afterEach(async () => {
    await removeFixtureRoads(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function pothole(
    segmentId: number,
    level: string,
    state: string,
    confidence: number,
  ): Promise<void> {
    await db.$executeRawUnsafe(
      `INSERT INTO potholes (road_segment_id, severity_level_id, status_id, latitude, longitude,
                             confidence, detection_count, first_detected_at, last_detected_at)
       VALUES (${segmentId}, ${severity[level]}, ${status[state]}, 1.2, -77.28, ${confidence}, 2,
               '${T}', '${T}')`,
    );
  }

  async function damageOf(segmentId: number) {
    const [row] = await db.$queryRawUnsafe<
      { damage_score: number; max_severity_level_id: number | null }[]
    >(
      `SELECT damage_score::float8 AS damage_score, max_severity_level_id
       FROM road_segments WHERE id = ${segmentId}`,
    );
    return row!;
  }

  it('adds severity weight x confidence of the confirmed potholes only', async () => {
    const [first] = road.segmentIds;
    await pothole(first!, 'grave', 'confirmado', 0.5); // 6 x 0.5 = 3
    await pothole(first!, 'leve', 'confirmado', 1); // 0.5
    await pothole(first!, 'grave', 'sin confirmar', 1); // does not count
    await pothole(first!, 'grave', 'reparado', 1); // does not count

    expect(await repository.recompute([first!])).toBe(1);
    expect(await damageOf(first!)).toEqual({
      damage_score: 3.5,
      max_severity_level_id: severity.grave,
    });
  });

  it('sets a segment back to no damage when its potholes are gone or not confirmed', async () => {
    const [first] = road.segmentIds;
    await pothole(first!, 'grave', 'confirmado', 1);
    await repository.recompute([first!]);

    await db.$executeRawUnsafe(
      `UPDATE potholes SET status_id = ${status['sin confirmar']} WHERE road_segment_id = ${first}`,
    );
    await repository.recompute([first!]);
    expect(await damageOf(first!)).toEqual({ damage_score: 0, max_severity_level_id: null });
  });

  it('only touches the segments it is asked about, and writes only what changed', async () => {
    const [first, second] = road.segmentIds;
    await pothole(first!, 'moderado', 'confirmado', 1);
    await pothole(second!, 'moderado', 'confirmado', 1);

    expect(await repository.recompute([first!])).toBe(1);
    expect((await damageOf(second!)).damage_score).toBe(0);

    expect(await repository.recompute([first!, first!])).toBe(0);
    expect(await repository.recompute([])).toBe(0);
  });
});

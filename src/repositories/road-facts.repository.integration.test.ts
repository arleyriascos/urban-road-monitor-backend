import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { insertFixtureRoad, removeFixtureRoads, type FixtureRoad } from '../test/road-fixture.js';
import { createTestClient, testDatabaseUrl } from '../test/test-database.js';
import { RoadFactsRepository } from './road-facts.repository.js';

/** The facts the street summaries are made from, against a real PostgreSQL. */
const url = testDatabaseUrl();
const T = '2026-11-10T10:00:00Z';

describe.skipIf(!url)('RoadFactsRepository (real database)', () => {
  let db: PrismaClient;
  let repository: RoadFactsRepository;
  let road: FixtureRoad;
  let severity: Record<string, number>;
  let status: Record<string, number>;

  beforeAll(async () => {
    db = createTestClient(url!);
    repository = new RoadFactsRepository(db);
    severity = Object.fromEntries((await db.severity_levels.findMany()).map((l) => [l.name, l.id]));
    status = Object.fromEntries((await db.pothole_statuses.findMany()).map((s) => [s.name, s.id]));
  });

  beforeEach(async () => {
    await removeFixtureRoads(db);
    road = await insertFixtureRoad(db, 0, 'Calle 1', 3);
  });

  afterEach(async () => {
    await removeFixtureRoads(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function pothole(segmentId: number, level: string, state: string) {
    await db.$executeRawUnsafe(
      `INSERT INTO potholes (road_segment_id, severity_level_id, status_id, latitude, longitude,
                             confidence, detection_count, first_detected_at, last_detected_at)
       VALUES (${segmentId}, ${severity[level]}, ${status[state]}, 1.2, -77.28, 1, 2, '${T}', '${T}')`,
    );
  }

  const ours = async () =>
    (await repository.findAll()).filter((facts) => facts.roadId === road.roadId);

  it('gives every segment of the street in order, with no potholes at first', async () => {
    const facts = await ours();
    expect(facts.map((f) => f.segmentIndex)).toEqual([0, 1, 2]);
    expect(facts[0]).toEqual({
      segmentId: road.segmentIds[0],
      roadId: road.roadId,
      roadName: 'Calle 1',
      segmentIndex: 0,
      lengthM: 100,
      visiblePotholes: 0,
      confirmedPotholes: 0,
      damageScore: 0,
      worstSeverity: null,
    });
  });

  it('counts the potholes that are shown and the ones that are confirmed', async () => {
    const [first] = road.segmentIds;
    await pothole(first!, 'grave', 'confirmado');
    await pothole(first!, 'leve', 'sin confirmar');
    await pothole(first!, 'grave', 'reparado');

    const [facts] = await ours();
    expect(facts).toMatchObject({ visiblePotholes: 2, confirmedPotholes: 1 });
  });

  it('gives the damage and the worst severity the segment holds', async () => {
    const [first] = road.segmentIds;
    await db.$executeRawUnsafe(
      `UPDATE road_segments SET damage_score = 3.5, max_severity_level_id = ${severity.grave} WHERE id = ${first}`,
    );
    const [facts] = await ours();
    expect(facts).toMatchObject({ damageScore: 3.5, worstSeverity: { name: 'grave', weight: 6 } });
  });

  it('gives a street without a name as null', async () => {
    const unnamed = await insertFixtureRoad(db, 1, null, 1);
    const facts = (await repository.findAll()).find((item) => item.roadId === unnamed.roadId);
    expect(facts?.roadName).toBeNull();
  });

  it('changes its stamp when a pothole is added, changed or removed, and not otherwise', async () => {
    const before = await repository.findStamp();
    expect(await repository.findStamp()).toBe(before);

    await pothole(road.segmentIds[0]!, 'leve', 'confirmado');
    const added = await repository.findStamp();
    expect(added).not.toBe(before);

    await db.$executeRawUnsafe(
      `UPDATE potholes SET confidence = 0.5 WHERE road_segment_id = ${road.segmentIds[0]}`,
    );
    const changed = await repository.findStamp();
    expect(changed).not.toBe(added);

    await db.$executeRawUnsafe(
      `DELETE FROM potholes WHERE road_segment_id = ${road.segmentIds[0]}`,
    );
    expect(await repository.findStamp()).not.toBe(changed);
  });
});

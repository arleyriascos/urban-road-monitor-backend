import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AiClusterError } from '../clustering/ai-cluster.client.js';
import { aiClusterResponseSchema, type AiClusterRequest } from '../clustering/ai-contract.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { ClusteringRunRepository } from '../repositories/clustering-run.repository.js';
import { ConsolidationRepository } from '../repositories/consolidation.repository.js';
import { ParameterRepository } from '../repositories/parameter.repository.js';
import { haversineDistance } from '../osm/geo.js';
import { insertFixtureRoad, removeFixtureRoads, type FixtureRoad } from '../test/road-fixture.js';
import {
  createTestClient,
  createTestUser,
  resetDatabase,
  testDatabaseUrl,
} from '../test/test-database.js';
import { ConsolidationService, type AiClusterPort } from './consolidation.service.js';

/** The whole consolidation, with the real tables and a stand-in for the AI service. */
const url = testDatabaseUrl();
const NOW = new Date('2026-11-16T12:00:00.000Z');
const hours = (n: number) => new Date(NOW.getTime() - n * 3_600_000);

/** A small DBSCAN-like grouping: detections within 5 m join; two or more make a confirmed pothole. */
function fakeAi(segmentId: number): AiClusterPort & { asleep: boolean } {
  const port = {
    asleep: false,
    async cluster(request: AiClusterRequest) {
      if (port.asleep) {
        throw new AiClusterError({ kind: 'hibernating', routing: 'hibernate-rate-limited' });
      }
      const groups: AiClusterRequest['detections'][] = [];
      for (const d of request.detections) {
        const group = groups.find((g) =>
          g.some(
            (o) => haversineDistance([o.latitude, o.longitude], [d.latitude, d.longitude]) <= 5,
          ),
        );
        if (group) group.push(d);
        else groups.push([d]);
      }
      const clusters = groups.map((group) => ({
        detectionIds: group.map((d) => d.id),
        count: group.length,
        latitude: group[0]!.latitude,
        longitude: group[0]!.longitude,
        severity: group[0]!.severity,
        confidence: 0.5,
        status: group.length >= 2 ? 'confirmed' : 'unconfirmed',
        segmentId,
        segmentDistanceM: 1,
        segmentFraction: 0.5,
        firstDetectedAt: group.map((d) => d.detectedAt).sort()[0]!,
        lastDetectedAt: group
          .map((d) => d.detectedAt)
          .sort()
          .at(-1)!,
      }));
      return aiClusterResponseSchema.parse({
        graphVersion: null,
        asOf: request.asOf,
        epsM: request.epsM,
        minPoints: request.minPoints,
        detectionCount: request.detections.length,
        clusterCount: clusters.length,
        confirmedCount: clusters.filter((c) => c.status === 'confirmed').length,
        placedCount: clusters.length,
        computationMs: 1,
        clusters,
      });
    },
  };
  return port;
}

describe.skipIf(!url)('ConsolidationService (real database)', () => {
  let db: PrismaClient;
  let road: FixtureRoad;
  let ai: ReturnType<typeof fakeAi>;
  let service: ConsolidationService;
  let tripId: string;
  let graveId: number;
  let counter = 0;

  beforeAll(async () => {
    db = createTestClient(url!);
    graveId = (await db.severity_levels.findFirstOrThrow({ where: { name: 'grave' } })).id;
  });

  beforeEach(async () => {
    await removeFixtureRoads(db);
    await resetDatabase(db);
    await db.$executeRawUnsafe('DELETE FROM potholes');
    await db.$executeRawUnsafe('DELETE FROM clustering_runs');
    road = await insertFixtureRoad(db, 0, 'Calle 1', 2);
    const userId = await createTestUser(db);
    const device = await db.devices.create({ data: { user_id: userId, platform: 'android' } });
    const model = await db.ai_models.findFirstOrThrow({ where: { is_active: true } });
    tripId = (
      await db.trips.create({
        data: {
          user_id: userId,
          device_id: device.id,
          ai_model_id: model.id,
          started_at: hours(48),
        },
      })
    ).id;
    ai = fakeAi(road.segmentIds[0]!);
    service = new ConsolidationService({
      runs: new ClusteringRunRepository(db),
      store: new ConsolidationRepository(db),
      parameters: new ParameterRepository(db),
      versions: { current: async () => 'test-version' },
      ai,
      clock: () => NOW,
    });
  });

  afterEach(async () => {
    await removeFixtureRoads(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function seen(latitude: number, hoursAgo = 1): Promise<void> {
    counter += 1;
    // Raw SQL with an explicit instant: the time of a Prisma Date can shift by the time zone of
    // the session (a database in America/Bogota), and these tests compare exact instants.
    const at = hours(hoursAgo).toISOString();
    await db.$executeRawUnsafe(
      `INSERT INTO detections (id, trip_id, severity_level_id, latitude, longitude,
                               model_confidence, bbox_area_ratio, detected_at, received_at)
       VALUES ('00000000-0000-4000-8000-${String(counter).padStart(12, '0')}', '${tripId}',
               ${graveId}, ${latitude}, -77.28, 0.9, 0.05, '${at}'::timestamptz, '${at}'::timestamptz)`,
    );
  }

  async function potholes() {
    return db.$queryRawUnsafe<
      { id: string; status: string; detection_count: number; linked: number }[]
    >(
      `SELECT p.id::text AS id, ps.name AS status, p.detection_count,
              (SELECT COUNT(*)::int FROM detections d WHERE d.pothole_id = p.id) AS linked
       FROM potholes p JOIN pothole_statuses ps ON ps.id = p.status_id ORDER BY p.latitude`,
    );
  }

  async function damage() {
    const [row] = await db.$queryRawUnsafe<{ damage: number }[]>(
      `SELECT damage_score::float8 AS damage FROM road_segments WHERE id = ${road.segmentIds[0]}`,
    );
    return row!.damage;
  }

  it('turns detections into potholes, confirms the ones seen twice and keeps their ids', async () => {
    await seen(1.2);
    await seen(1.200001);
    await seen(1.2005); // far away, seen once

    const first = await service.run('automatic');
    expect(first).toMatchObject({
      kind: 'finished',
      stats: { potholesCreated: 2, clustersFound: 2 },
    });
    const afterFirst = await potholes();
    expect(afterFirst.map((p) => [p.status, p.detection_count, p.linked])).toEqual([
      ['confirmado', 2, 2],
      ['sin confirmar', 1, 1],
    ]);
    expect(await damage()).toBe(3); // only the confirmed one: grave 6 x 0.5

    await seen(1.200501); // the lonely pothole is seen again
    const second = await service.run('automatic');
    expect(second).toMatchObject({
      kind: 'finished',
      stats: { potholesCreated: 0, potholesUpdated: 2 },
    });
    const afterSecond = await potholes();
    expect(afterSecond.map((p) => p.id)).toEqual(afterFirst.map((p) => p.id));
    expect(afterSecond.map((p) => p.status)).toEqual(['confirmado', 'confirmado']);
    expect(await damage()).toBe(6);
  });

  it('changes nothing when it runs again with nothing new', async () => {
    await seen(1.2);
    await seen(1.200001);
    await service.run('automatic');
    const before = await potholes();

    const outcome = await service.run('automatic');

    expect(outcome).toMatchObject({
      kind: 'finished',
      stats: { potholesCreated: 0, potholesRemoved: 0 },
      segmentsChanged: 0,
    });
    expect(await potholes()).toEqual(before);
    expect(await db.clustering_runs.count()).toBe(2);
  });

  it('removes a pothole whose detections grew too old, and clears the damage it caused', async () => {
    await seen(1.2, 1);
    await seen(1.200001, 1);
    await service.run('automatic');
    expect(await damage()).toBe(3);

    await db.$executeRawUnsafe(
      `UPDATE detections SET detected_at = '${hours(24 * 100).toISOString()}'`,
    );
    const outcome = await service.run('automatic');

    expect(outcome).toMatchObject({ kind: 'finished', stats: { potholesRemoved: 1 } });
    expect(await potholes()).toEqual([]);
    expect(await damage()).toBe(0);
  });

  it('never touches the invented potholes of the seed', async () => {
    await db.$executeRawUnsafe(
      `INSERT INTO potholes (severity_level_id, status_id, latitude, longitude, confidence,
                             detection_count, first_detected_at, last_detected_at)
       SELECT ${graveId}, id, 1.3, -77.28, 1, 5, now(), now() FROM pothole_statuses WHERE name = 'confirmado'`,
    );
    await seen(1.2);
    await seen(1.200001);
    await service.run('automatic');
    expect(await db.potholes.count()).toBe(2);
  });

  it('keeps a repaired pothole repaired until it is seen again after the repair', async () => {
    await seen(1.2, 5);
    await seen(1.200001, 5);
    await service.run('automatic');
    const [pothole] = await potholes();
    await db.$executeRawUnsafe(
      `UPDATE potholes SET status_id = (SELECT id FROM pothole_statuses WHERE name = 'reparado')
       WHERE id = '${pothole!.id}'`,
    );

    // The repair is dated by the database's own clock; the test fixes it to two hours ago.
    await db.$executeRawUnsafe(
      `UPDATE pothole_status_history SET changed_at = '${hours(2).toISOString()}'
       WHERE pothole_id = '${pothole!.id}' AND status_id = (SELECT id FROM pothole_statuses WHERE name = 'reparado')`,
    );

    await service.run('automatic');
    expect((await potholes())[0]?.status).toBe('reparado');

    await seen(1.200002, 0); // seen again, after the repair
    await service.run('automatic');
    expect((await potholes())[0]).toMatchObject({ id: pothole!.id, status: 'confirmado' });
  });

  it('records a failed run and leaves the potholes as they were when the AI service sleeps', async () => {
    await seen(1.2);
    await seen(1.200001);
    await service.run('automatic');
    const before = await potholes();

    ai.asleep = true;
    await seen(1.2005);
    const outcome = await service.run('automatic');

    expect(outcome).toMatchObject({ kind: 'failed', code: 'AI_HIBERNATING' });
    expect(await potholes()).toEqual(before);
    const [latest] = await new ClusteringRunRepository(db).list(1);
    expect(latest).toMatchObject({ status: 'failed', errorCode: 'AI_HIBERNATING' });

    ai.asleep = false;
    expect(await service.run('automatic')).toMatchObject({ kind: 'finished' });
  });
});

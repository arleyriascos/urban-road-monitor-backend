import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FoundCluster } from '../clustering/ai-contract.js';
import type { ReconcilePlan } from '../clustering/reconcile.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { insertFixtureRoad, removeFixtureRoads, type FixtureRoad } from '../test/road-fixture.js';
import {
  createTestClient,
  createTestUser,
  resetDatabase,
  testDatabaseUrl,
} from '../test/test-database.js';
import { ClusteringRunRepository } from './clustering-run.repository.js';
import { ConsolidationRepository } from './consolidation.repository.js';

/** Reading the detections of a run and writing its result, against a real PostgreSQL. */
const url = testDatabaseUrl();
const T0 = new Date('2026-11-16T12:00:00.000Z');
const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);

function id(prefix: number, n: number): string {
  return `${String(prefix).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function cluster(detectionIds: string[], change: Partial<FoundCluster> = {}): FoundCluster {
  return {
    detectionIds,
    count: detectionIds.length,
    latitude: 1.2,
    longitude: -77.28,
    severity: 'grave',
    confidence: 0.5,
    confirmed: detectionIds.length > 1,
    segmentId: null,
    firstDetectedAt: days(-3),
    lastDetectedAt: days(-1),
    ...change,
  };
}

describe.skipIf(!url)('ConsolidationRepository (real database)', () => {
  let db: PrismaClient;
  let repository: ConsolidationRepository;
  let runs: ClusteringRunRepository;
  let road: FixtureRoad;
  let tripId: string;
  let severity: Record<string, number>;
  let status: Record<string, number>;
  let runId: number;

  beforeAll(async () => {
    db = createTestClient(url!);
    repository = new ConsolidationRepository(db);
    runs = new ClusteringRunRepository(db);
    severity = Object.fromEntries(
      (await db.severity_levels.findMany()).map((level) => [level.name, level.id]),
    );
    status = Object.fromEntries(
      (await db.pothole_statuses.findMany()).map((item) => [item.name, item.id]),
    );
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
          started_at: days(-5),
        },
      })
    ).id;
    runId = (await runs.start({
      trigger: 'automatic',
      requestedBy: null,
      epsM: 5,
      minPoints: 2,
      windowDays: 90,
      startedAt: T0,
    }))!;
  });

  afterEach(async () => {
    await removeFixtureRoads(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function detection(n: number, detectedAt: Date, level = 'moderado'): Promise<string> {
    const detectionId = id(1, n);
    await db.detections.create({
      data: {
        id: detectionId,
        trip_id: tripId,
        severity_level_id: severity[level]!,
        latitude: 1.2 + n / 1e6,
        longitude: -77.28,
        model_confidence: 0.8,
        bbox_area_ratio: 0.02,
        detected_at: detectedAt,
        received_at: detectedAt,
      },
    });
    return detectionId;
  }

  async function oldPothole(state: string, segmentId: number | null, withRun = true) {
    const rows = await db.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO potholes (road_segment_id, severity_level_id, status_id, last_clustering_run_id,
                             latitude, longitude, confidence, detection_count,
                             first_detected_at, last_detected_at)
       VALUES (${segmentId ?? 'NULL'}, ${severity.grave}, ${status[state]}, ${withRun ? runId : 'NULL'},
               1.2, -77.28, 1, 2, '${days(-9).toISOString()}', '${days(-8).toISOString()}')
       RETURNING id::text AS id`,
    );
    return rows[0]!.id;
  }

  const plan = (change: Partial<ReconcilePlan>): ReconcilePlan => ({
    potholes: [],
    removedIds: [],
    unlinkedDetectionIds: [],
    ...change,
  });

  describe('loadDetections', () => {
    it('reads the detections of the window, newest first, with their pothole and severity', async () => {
      const recent = await detection(1, days(-1));
      const older = await detection(2, days(-10), 'leve');
      await detection(3, days(-100));
      const potholeId = await oldPothole('confirmado', null);
      await db.$executeRawUnsafe(
        `UPDATE detections SET pothole_id = '${potholeId}' WHERE id = '${older}'`,
      );

      const read = await repository.loadDetections(days(-90), 100);

      expect(read.map((d) => d.id)).toEqual([recent, older]);
      expect(read[0]).toMatchObject({ severity: 'moderado', confidence: 0.8, potholeId: null });
      expect(read[1]).toMatchObject({ severity: 'leve', potholeId });
      expect(read[0]?.detectedAt).toEqual(days(-1));
    });

    it('stops at the limit and keeps the newest', async () => {
      await detection(1, days(-3));
      const newest = await detection(2, days(-1));
      const read = await repository.loadDetections(days(-90), 1);
      expect(read.map((d) => d.id)).toEqual([newest]);
    });
  });

  describe('loadDerivedPotholes', () => {
    it('gives the potholes of earlier runs and leaves out those of the seed', async () => {
      const derived = await oldPothole('confirmado', road.segmentIds[0]!);
      await oldPothole('confirmado', road.segmentIds[0]!, false);
      const linked = await oldPothole('sin confirmar', null, false);
      const detectionId = await detection(1, days(-1));
      await db.$executeRawUnsafe(
        `UPDATE detections SET pothole_id = '${linked}' WHERE id = '${detectionId}'`,
      );

      const read = await repository.loadDerivedPotholes();

      expect(read.map((p) => p.id).sort()).toEqual([derived, linked].sort());
      expect(read.find((p) => p.id === derived)).toMatchObject({
        statusName: 'confirmado',
        segmentId: road.segmentIds[0],
        repairedAt: null,
      });
    });

    it('tells when a pothole was last marked as repaired', async () => {
      const potholeId = await oldPothole('confirmado', null);
      await db.$executeRawUnsafe(
        `UPDATE potholes SET status_id = ${status.reparado} WHERE id = '${potholeId}'`,
      );
      const [read] = await repository.loadDerivedPotholes();
      expect(read?.statusName).toBe('reparado');
      expect(read?.repairedAt).toBeInstanceOf(Date);
    });
  });

  describe('apply', () => {
    it('creates a pothole, links its detections and works out the damage of its segment', async () => {
      const a = await detection(1, days(-2));
      const b = await detection(2, days(-1));
      const potholeId = id(2, 1);
      const segmentId = road.segmentIds[0]!;

      const result = await repository.apply(
        plan({
          potholes: [
            {
              id: potholeId,
              isNew: true,
              cluster: cluster([a, b], { segmentId }),
              status: 'confirmado',
              previousSegmentId: null,
            },
          ],
        }),
        runId,
      );

      expect(result).toEqual({ created: 1, updated: 0, removed: 0, segmentsChanged: 1 });
      const [row] = await db.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT p.status_id, p.detection_count, p.confidence::float8 AS confidence,
                p.last_clustering_run_id, p.road_segment_id::text AS segment,
                (SELECT COUNT(*)::int FROM detections WHERE pothole_id = p.id) AS linked,
                (SELECT damage_score::float8 FROM road_segments WHERE id = ${segmentId}) AS damage
         FROM potholes p WHERE p.id = '${potholeId}'`,
      );
      expect(row).toMatchObject({
        status_id: status.confirmado,
        detection_count: 2,
        confidence: 0.5,
        last_clustering_run_id: runId,
        segment: String(segmentId),
        linked: 2,
        damage: 3, // grave 6 x 0.5
      });
    });

    it('does not let an unconfirmed pothole change the damage of its segment', async () => {
      const a = await detection(1, days(-1));
      const segmentId = road.segmentIds[0]!;
      const result = await repository.apply(
        plan({
          potholes: [
            {
              id: id(2, 1),
              isNew: true,
              cluster: cluster([a], { segmentId }),
              status: 'sin confirmar',
              previousSegmentId: null,
            },
          ],
        }),
        runId,
      );
      expect(result.segmentsChanged).toBe(0);
    });

    it('updates a pothole in place, keeping its id, and records the change of status', async () => {
      const segmentId = road.segmentIds[0]!;
      const potholeId = await oldPothole('sin confirmar', segmentId);
      const a = await detection(1, days(-2));
      const b = await detection(2, days(-1));

      const result = await repository.apply(
        plan({
          potholes: [
            {
              id: potholeId,
              isNew: false,
              cluster: cluster([a, b], { segmentId }),
              status: 'confirmado',
              previousSegmentId: segmentId,
            },
          ],
        }),
        runId,
      );

      expect(result).toMatchObject({ created: 0, updated: 1, removed: 0 });
      const history = await db.$queryRawUnsafe<{ status: string }[]>(
        `SELECT ps.name AS status FROM pothole_status_history h
         JOIN pothole_statuses ps ON ps.id = h.status_id
         WHERE h.pothole_id = '${potholeId}' ORDER BY h.id DESC LIMIT 1`,
      );
      expect(history[0]?.status).toBe('confirmado');
      expect(await db.potholes.count()).toBe(1);
    });

    it('removes a pothole, frees its detections and clears the damage it caused', async () => {
      const segmentId = road.segmentIds[0]!;
      const potholeId = await oldPothole('confirmado', segmentId);
      const a = await detection(1, days(-1));
      await db.$executeRawUnsafe(
        `UPDATE detections SET pothole_id = '${potholeId}' WHERE id = '${a}'`,
      );
      await db.$executeRawUnsafe(
        `UPDATE road_segments SET damage_score = 6, max_severity_level_id = ${severity.grave} WHERE id = ${segmentId}`,
      );

      const result = await repository.apply(
        plan({ removedIds: [potholeId], unlinkedDetectionIds: [a] }),
        runId,
      );

      expect(result).toMatchObject({ removed: 1, segmentsChanged: 1 });
      expect(await db.potholes.count()).toBe(0);
      const [segment] = await db.$queryRawUnsafe<{ damage: number }[]>(
        `SELECT damage_score::float8 AS damage FROM road_segments WHERE id = ${segmentId}`,
      );
      expect(segment?.damage).toBe(0);
      const [free] = await db.$queryRawUnsafe<{ pothole_id: string | null }[]>(
        `SELECT pothole_id FROM detections WHERE id = '${a}'`,
      );
      expect(free?.pothole_id).toBeNull();
    });

    it('puts a pothole on no segment when the one the AI service gave does not exist', async () => {
      const a = await detection(1, days(-1));
      const potholeId = id(2, 1);
      await repository.apply(
        plan({
          potholes: [
            {
              id: potholeId,
              isNew: true,
              cluster: cluster([a], { segmentId: 999_999_999 }),
              status: 'sin confirmar',
              previousSegmentId: null,
            },
          ],
        }),
        runId,
      );
      const [row] = await db.$queryRawUnsafe<{ road_segment_id: bigint | null }[]>(
        `SELECT road_segment_id FROM potholes WHERE id = '${potholeId}'`,
      );
      expect(row?.road_segment_id).toBeNull();
    });

    it('writes nothing at all when something fails half way', async () => {
      const a = await detection(1, days(-1));
      const keep = await oldPothole('confirmado', null);
      const bad = {
        id: id(2, 1),
        isNew: true,
        cluster: cluster([a], { confidence: 7 }), // the table refuses a confidence above 1
        status: 'confirmado' as const,
        previousSegmentId: null,
      };
      await expect(
        repository.apply(plan({ potholes: [bad], removedIds: [keep] }), runId),
      ).rejects.toThrow();
      expect(await db.potholes.count()).toBe(1);
    });
  });
});

import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { errorHandler } from '../middlewares/error-handler.js';
import { RoadFactsRepository } from '../repositories/road-facts.repository.js';
import { SegmentDamageRepository } from '../repositories/segment-damage.repository.js';
import { createRoadSummaryRouter } from '../routes/road-summary.routes.js';
import { RoadSummaryService } from '../services/road-summary.service.js';
import { insertFixtureRoad, removeFixtureRoads, type FixtureRoad } from '../test/road-fixture.js';
import { createTestClient, testDatabaseUrl } from '../test/test-database.js';
import { RoadSummaryController } from './road-summary.controller.js';

/** The street summaries as the map asks for them, against a real PostgreSQL. */
const url = testDatabaseUrl();
const T = '2026-11-10T10:00:00Z';

interface Json {
  [key: string]: unknown;
}

describe.skipIf(!url)('street summaries, end to end (real database)', () => {
  let db: PrismaClient;
  let baseUrl: string;
  let close: () => Promise<unknown>;
  let road: FixtureRoad;
  let severity: Record<string, number>;
  let status: Record<string, number>;
  let now = 0;

  beforeAll(async () => {
    db = createTestClient(url!);
    severity = Object.fromEntries((await db.severity_levels.findMany()).map((l) => [l.name, l.id]));
    status = Object.fromEntries((await db.pothole_statuses.findMany()).map((s) => [s.name, s.id]));
    const service = new RoadSummaryService({
      facts: new RoadFactsRepository(db),
      clock: () => now,
    });
    const app = express();
    app.use(
      '/api',
      createRoadSummaryRouter(new RoadSummaryController(service), (_req, _res, next) => next()),
    );
    app.use(errorHandler);
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((resolve) => server.close(resolve));
  });

  beforeEach(async () => {
    await removeFixtureRoads(db);
    road = await insertFixtureRoad(db, 0, 'Calle 18', 6);
    now += 60_000; // every test starts with the check of the previous one expired
  });

  afterEach(async () => {
    await removeFixtureRoads(db);
  });

  afterAll(async () => {
    await close();
    await db.$disconnect();
  });

  async function get(path: string) {
    const response = await fetch(`${baseUrl}${path}`);
    return {
      status: response.status,
      body: (await response.json()) as Json,
      headers: response.headers,
    };
  }

  async function pothole(position: number, level: string, state: string, confidence = 1) {
    const segmentId = road.segmentIds[position]!;
    await db.$executeRawUnsafe(
      `INSERT INTO potholes (road_segment_id, severity_level_id, status_id, latitude, longitude,
                             confidence, detection_count, first_detected_at, last_detected_at)
       VALUES (${segmentId}, ${severity[level]}, ${status[state]}, 1.2, -77.28, ${confidence}, 2, '${T}', '${T}')`,
    );
    await new SegmentDamageRepository(db).recompute([segmentId]);
  }

  it('describes the segment, the stretch around it and the whole street', async () => {
    await pothole(2, 'grave', 'confirmado', 0.5); // damage 3
    await pothole(3, 'leve', 'sin confirmar'); // shown, but no damage
    await pothole(5, 'moderado', 'confirmado'); // damage 2

    const {
      status: code,
      body,
      headers,
    } = await get(`/api/road-segments/${road.segmentIds[3]}/summary?radius=1`);

    expect(code).toBe(200);
    expect(headers.get('cache-control')).toBe('public, max-age=10');
    expect(body.segment).toMatchObject({
      id: road.segmentIds[3],
      roadId: road.roadId,
      roadName: 'Calle 18',
      position: 4,
      segmentsInRoad: 6,
    });
    expect(body.window).toMatchObject({
      fromSegmentIndex: 2,
      toSegmentIndex: 4,
      summary: {
        segments: 3,
        lengthM: 300,
        visiblePotholes: 2,
        confirmedPotholes: 1,
        damageScore: 3,
        worstSeverity: { name: 'grave', weight: 6 },
      },
    });
    expect(body.road).toMatchObject({
      summary: { segments: 6, visiblePotholes: 3, confirmedPotholes: 2, damageScore: 5 },
    });
  });

  it('adds up a stretch of a street, and an empty range is not an error', async () => {
    await pothole(1, 'grave', 'confirmado');
    await pothole(4, 'grave', 'confirmado');

    const middle = await get(`/api/roads/${road.roadId}/summary?from=1&to=3`);
    expect(middle.body).toMatchObject({ fromSegmentIndex: 1, toSegmentIndex: 3 });
    expect((middle.body.summary as Json).damageScore).toBe(6);

    const whole = await get(`/api/roads/${road.roadId}/summary`);
    expect((whole.body.summary as Json).damageScore).toBe(12);

    const empty = await get(`/api/roads/${road.roadId}/summary?from=50&to=60`);
    expect(empty.status).toBe(200);
    expect((empty.body.summary as Json).segments).toBe(0);
  });

  it('follows the database: a pothole that is repaired stops counting after the check expires', async () => {
    await pothole(1, 'grave', 'confirmado');
    expect(
      ((await get(`/api/roads/${road.roadId}/summary`)).body.summary as Json).damageScore,
    ).toBe(6);

    await db.$executeRawUnsafe(
      `UPDATE potholes SET status_id = ${status.reparado} WHERE road_segment_id = ${road.segmentIds[1]}`,
    );
    await new SegmentDamageRepository(db).recompute([road.segmentIds[1]!]);

    // Within the 10 seconds the answer is the same; after them it follows the database.
    expect(
      ((await get(`/api/roads/${road.roadId}/summary`)).body.summary as Json).damageScore,
    ).toBe(6);
    now += 11_000;
    const after = await get(`/api/roads/${road.roadId}/summary`);
    expect(after.body.summary).toMatchObject({
      damageScore: 0,
      visiblePotholes: 0,
      worstSeverity: null,
    });
  });

  it('answers 404 for a segment or a street that does not exist, and 400 for a bad request', async () => {
    expect((await get('/api/road-segments/999999999999999/summary')).status).toBe(404);
    expect((await get('/api/roads/999999999999999/summary')).status).toBe(404);
    expect((await get('/api/roads/abc/summary')).status).toBe(400);
    expect((await get(`/api/roads/${road.roadId}/summary?from=3`)).status).toBe(400);
  });
});

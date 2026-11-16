import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { errorHandler } from '../middlewares/error-handler.js';
import { RoadSearchRepository } from '../repositories/road-search.repository.js';
import { createRoadSearchRouter } from '../routes/road-search.routes.js';
import { RoadSearchService } from '../services/road-search.service.js';
import { insertFixtureRoad, removeFixtureRoads, type FixtureRoad } from '../test/road-fixture.js';
import { createTestClient, testDatabaseUrl } from '../test/test-database.js';
import { RoadSearchController } from './road-search.controller.js';

/** The street search as the map asks for it, against a real PostgreSQL. */
const url = testDatabaseUrl();

interface Match {
  name: string;
  roadIds: number[];
  segments: number;
  center: { latitude: number; longitude: number };
}

describe.skipIf(!url)('street search, end to end (real database)', () => {
  let db: PrismaClient;
  let baseUrl: string;
  let close: () => Promise<unknown>;
  let now = 0;
  let calle: FixtureRoad;

  beforeAll(async () => {
    db = createTestClient(url!);
    const service = new RoadSearchService({
      roads: new RoadSearchRepository(db),
      clock: () => now,
    });
    const app = express();
    app.use(
      '/api',
      createRoadSearchRouter(new RoadSearchController(service), (_req, _res, next) => next()),
    );
    app.use(errorHandler);
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((resolve) => server.close(resolve));
  });

  beforeEach(async () => {
    await removeFixtureRoads(db);
    calle = await insertFixtureRoad(db, 0, 'Zz Avenida Ñandú', 4);
    await insertFixtureRoad(db, 1, 'Zz Avenida Ñandú', 2); // another way of the same street
    await insertFixtureRoad(db, 2, 'Zz Carrera 9', 3);
    await insertFixtureRoad(db, 3, null, 3);
    now += 120_000; // the check of the previous test has expired
  });

  afterEach(async () => {
    await removeFixtureRoads(db);
  });

  afterAll(async () => {
    await close();
    await db.$disconnect();
  });

  async function search(query: string) {
    const response = await fetch(`${baseUrl}/api/roads/search?${query}`);
    return { status: response.status, body: (await response.json()) as { streets?: Match[] } };
  }

  it('finds a street by the beginning of its name, without accents or capitals', async () => {
    const { status, body } = await search('q=zz%20AVENIDA%20nandu');
    expect(status).toBe(200);
    expect(body.streets).toHaveLength(1);
    expect(body.streets![0]).toMatchObject({ name: 'Zz Avenida Ñandú', segments: 6 });
  });

  it('joins the ways that share the name and gives where to center the map', async () => {
    const { body } = await search('q=zz%20av');
    const match = body.streets![0]!;
    expect(match.roadIds).toHaveLength(2);
    expect(match.roadIds).toContain(calle.roadId);
    expect(match.center.longitude).toBeCloseTo(-77.28, 6);
    // The first way goes north 4 x 0.0009° from 1.2; the second starts 0.05° further north.
    expect(match.center.latitude).toBeGreaterThan(1.2);
    expect(match.center.latitude).toBeLessThan(1.26);
  });

  it('finds the streets in alphabetical order and respects the limit', async () => {
    const all = await search('q=zz');
    expect(all.body.streets!.map((m) => m.name)).toEqual(['Zz Avenida Ñandú', 'Zz Carrera 9']);
    expect((await search('q=zz&limit=1')).body.streets).toHaveLength(1);
  });

  it('answers nothing, not an error, when no street matches', async () => {
    const { status, body } = await search('q=nothing-like-this-qqq');
    expect(status).toBe(200);
    expect(body.streets).toEqual([]);
  });

  it('follows the database: a street that is added is found after the check expires', async () => {
    expect((await search('q=zz%20plaza')).body.streets).toEqual([]);
    await insertFixtureRoad(db, 4, 'Zz Plaza Nariño', 2);
    now += 61_000;
    expect((await search('q=zz%20plaza')).body.streets!.map((m) => m.name)).toEqual([
      'Zz Plaza Nariño',
    ]);
  });

  it('answers 400 for a missing text', async () => {
    expect((await search('')).status).toBe(400);
    expect((await search('q=')).status).toBe(400);
  });
});

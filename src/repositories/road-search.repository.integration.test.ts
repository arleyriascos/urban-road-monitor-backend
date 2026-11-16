import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { insertFixtureRoad, removeFixtureRoads } from '../test/road-fixture.js';
import { createTestClient, testDatabaseUrl } from '../test/test-database.js';
import { RoadSearchRepository } from './road-search.repository.js';

const url = testDatabaseUrl();

describe.skipIf(!url)('RoadSearchRepository (real database)', () => {
  let db: PrismaClient;
  let repository: RoadSearchRepository;

  beforeAll(() => {
    db = createTestClient(url!);
    repository = new RoadSearchRepository(db);
  });

  beforeEach(async () => {
    await removeFixtureRoads(db);
  });

  afterEach(async () => {
    await removeFixtureRoads(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('reads the named streets with the box that contains them', async () => {
    const named = await insertFixtureRoad(db, 0, 'Calle 18', 4);
    await insertFixtureRoad(db, 1, null, 3);
    await insertFixtureRoad(db, 2, '   ', 3);

    const places = (await repository.findAll()).filter((p) => p.roadId === named.roadId);

    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ name: 'Calle 18', segments: 4 });
    // 4 segments of 0.0009° going north from latitude 1.2, along longitude -77.28.
    expect(places[0]!.minLatitude).toBeCloseTo(1.2, 6);
    expect(places[0]!.maxLatitude).toBeCloseTo(1.2036, 6);
    expect(places[0]!.minLongitude).toBeCloseTo(-77.28, 6);
    expect(places[0]!.maxLongitude).toBeCloseTo(-77.28, 6);
  });

  it('leaves out the roads without name or with a blank one', async () => {
    const blank = await insertFixtureRoad(db, 1, null, 2);
    const spaces = await insertFixtureRoad(db, 2, '   ', 2);
    const ids = (await repository.findAll()).map((p) => p.roadId);
    expect(ids).not.toContain(blank.roadId);
    expect(ids).not.toContain(spaces.roadId);
  });

  it('changes the stamp when a street is added and when it is removed', async () => {
    const before = await repository.findStamp();
    await insertFixtureRoad(db, 0, 'Calle 1', 2);
    const added = await repository.findStamp();
    expect(added).not.toBe(before);
    await removeFixtureRoads(db);
    expect(await repository.findStamp()).toBe(before);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifySeverity } from '../detections/severity.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createTestClient, testDatabaseUrl } from '../test/test-database.js';
import { SeverityRepository } from './severity.repository.js';

/** These tests run against a real PostgreSQL; they are skipped without TEST_DATABASE_URL. */
const url = testDatabaseUrl();

describe.skipIf(!url)('SeverityRepository (real database)', () => {
  let db: PrismaClient;
  let repository: SeverityRepository;

  beforeAll(() => {
    db = createTestClient(url!);
    repository = new SeverityRepository(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('reads the three levels in order, with the limits of migration 09', async () => {
    const levels = await repository.findAll();

    expect(levels.map((level) => [level.name, level.minAreaRatio, level.maxAreaRatio])).toEqual([
      ['leve', 0, 0.01],
      ['moderado', 0.01, 0.04],
      ['grave', 0.04, 1],
    ]);
  });

  it('gives ids that the detections table accepts', async () => {
    const levels = await repository.findAll();
    const ids = (await db.severity_levels.findMany({ select: { id: true } })).map((row) => row.id);

    expect(levels.every((level) => ids.includes(level.id))).toBe(true);
  });

  it('works with the classifier: every area from 0.0001 to 1 lands in some level', async () => {
    const levels = await repository.findAll();

    for (let ratio = 0.0001; ratio <= 1; ratio += 0.0007) {
      expect(classifySeverity(Number(ratio.toFixed(4)), levels)).toBeDefined();
    }
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createTestClient, testDatabaseUrl } from '../test/test-database.js';
import { ParameterRepository } from './parameter.repository.js';

/** These tests run against a real PostgreSQL; they are skipped without TEST_DATABASE_URL. */
const url = testDatabaseUrl();
const KEY = 'test_parameter';

describe.skipIf(!url)('ParameterRepository (real database)', () => {
  let db: PrismaClient;
  let repository: ParameterRepository;

  beforeAll(() => {
    db = createTestClient(url!);
    repository = new ParameterRepository(db);
  });

  afterAll(async () => {
    await db.system_parameters.deleteMany({ where: { key: KEY } });
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.system_parameters.deleteMany({ where: { key: KEY } });
  });

  it('reads a whole number', async () => {
    await db.system_parameters.create({ data: { key: KEY, value: '20' } });

    expect(await repository.getNumber(KEY, 999)).toBe(20);
  });

  it('reads a number with decimals', async () => {
    await db.system_parameters.create({ data: { key: KEY, value: '0.25' } });

    expect(await repository.getNumber(KEY, 1)).toBe(0.25);
  });

  it('uses the fallback when the key does not exist', async () => {
    expect(await repository.getNumber('no_such_parameter', 7)).toBe(7);
  });

  it.each(['abc', '', '   ', 'Infinity', 'NaN'])(
    'uses the fallback for the text "%s"',
    async (text) => {
      await db.system_parameters.create({ data: { key: KEY, value: text } });

      expect(await repository.getNumber(KEY, 7)).toBe(7);
    },
  );
});

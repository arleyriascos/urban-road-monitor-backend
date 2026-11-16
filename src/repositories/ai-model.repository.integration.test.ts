import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createTestClient, testDatabaseUrl } from '../test/test-database.js';
import { AiModelRepository } from './ai-model.repository.js';

/** These tests run against a real PostgreSQL; they are skipped without TEST_DATABASE_URL. */
const url = testDatabaseUrl();

describe.skipIf(!url)('AiModelRepository (real database)', () => {
  let db: PrismaClient;
  let repository: AiModelRepository;

  beforeAll(() => {
    db = createTestClient(url!);
    repository = new AiModelRepository(db);
  });

  afterAll(async () => {
    await db.$executeRaw`DELETE FROM ai_models WHERE name = 'Prueba'`;
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRaw`DELETE FROM ai_models WHERE name = 'Prueba'`;
  });

  it('finds the model that migration 09 leaves active', async () => {
    const model = await repository.findActive();

    expect(model).toMatchObject({ name: 'YOLOv8n Baches', version: '1.0.0', minConfidence: 0.4 });
    expect(model?.id).toBeGreaterThan(0);
  });

  it('prefers the newest active model if two are marked', async () => {
    await db.ai_models.create({
      data: {
        name: 'Prueba',
        version: '9.9.9',
        framework: 'onnxruntime-web',
        input_size: 416,
        min_confidence: 0.55,
        is_active: true,
        released_at: new Date('2099-01-01T00:00:00Z'),
      },
    });

    expect(await repository.findActive()).toMatchObject({ name: 'Prueba', minConfidence: 0.55 });
  });

  it('finds nothing when no model is active', async () => {
    await db.ai_models.updateMany({ data: { is_active: false } });
    try {
      expect(await repository.findActive()).toBeNull();
    } finally {
      await db.ai_models.updateMany({
        where: { name: 'YOLOv8n Baches', version: '1.0.0' },
        data: { is_active: true },
      });
    }
  });
});

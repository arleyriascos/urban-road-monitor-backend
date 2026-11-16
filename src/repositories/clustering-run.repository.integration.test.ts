import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  createTestClient,
  createTestUser,
  resetDatabase,
  testDatabaseUrl,
} from '../test/test-database.js';
import { ClusteringRunRepository, type NewRun } from './clustering-run.repository.js';

/** The record of the consolidation runs, against a real PostgreSQL. */
const url = testDatabaseUrl();
const T0 = new Date('2026-11-16T12:00:00.000Z');
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

function newRun(change: Partial<NewRun> = {}): NewRun {
  return {
    trigger: 'automatic',
    requestedBy: null,
    epsM: 5,
    minPoints: 2,
    windowDays: 90,
    startedAt: T0,
    ...change,
  };
}

const STATS = {
  detectionsProcessed: 10,
  clustersFound: 4,
  potholesCreated: 3,
  potholesUpdated: 1,
  potholesRemoved: 2,
};

describe.skipIf(!url)('ClusteringRunRepository (real database)', () => {
  let db: PrismaClient;
  let repository: ClusteringRunRepository;

  beforeAll(() => {
    db = createTestClient(url!);
    repository = new ClusteringRunRepository(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
    await db.$executeRawUnsafe('DELETE FROM potholes');
    await db.$executeRawUnsafe('DELETE FROM clustering_runs');
  });

  it('starts a run that is running, with its parameters', async () => {
    const id = await repository.start(newRun());
    expect(id).not.toBeNull();
    expect(await repository.findLatest()).toMatchObject({
      id,
      status: 'running',
      trigger: 'automatic',
      epsM: 5,
      minPoints: 2,
      windowDays: 90,
      startedAt: T0,
      finishedAt: null,
    });
  });

  it('does not let a second run start while one is running', async () => {
    expect(await repository.start(newRun())).not.toBeNull();
    expect(await repository.start(newRun({ trigger: 'manual' }))).toBeNull();
    expect(await repository.list(10)).toHaveLength(1);
  });

  it('lets the next run start once the first one finished or failed', async () => {
    const first = (await repository.start(newRun()))!;
    await repository.finish(first, STATS, minutes(1));
    const second = (await repository.start(newRun({ startedAt: minutes(2) })))!;
    await repository.fail(second, 'AI_UNAVAILABLE', 'x'.repeat(500), minutes(3));
    expect(await repository.start(newRun({ startedAt: minutes(4) }))).not.toBeNull();

    const [latest, failed, finished] = await repository.list(10);
    expect(latest?.status).toBe('running');
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'AI_UNAVAILABLE' });
    expect(failed?.errorMessage).toHaveLength(300);
    expect(finished).toMatchObject({ status: 'finished', ...STATS, finishedAt: minutes(1) });
  });

  it('records who asked for a manual run', async () => {
    const userId = await createTestUser(db);
    await repository.start(newRun({ trigger: 'manual', requestedBy: userId }));
    expect(await repository.findLatest()).toMatchObject({ trigger: 'manual', requestedBy: userId });
  });

  it('does not close a run twice', async () => {
    const id = (await repository.start(newRun()))!;
    await repository.finish(id, STATS, minutes(1));
    await repository.fail(id, 'LATE', 'too late', minutes(2));
    expect(await repository.findLatest()).toMatchObject({ status: 'finished' });
  });

  it('abandons a run that has been running for too long, and only that one', async () => {
    const old = (await repository.start(newRun({ startedAt: minutes(-30) })))!;
    expect(await repository.abandonStale(minutes(-10), T0)).toBe(1);
    expect(await repository.findLatest()).toMatchObject({
      id: old,
      status: 'failed',
      errorCode: 'ABANDONED',
    });

    const fresh = await repository.start(newRun({ startedAt: minutes(-5) }));
    expect(fresh).not.toBeNull();
    expect(await repository.abandonStale(minutes(-10), T0)).toBe(0);
  });

  it('knows when the last good run started and how many detections came after it', async () => {
    expect(await repository.findLastFinishedStart()).toBeNull();
    expect(await repository.countDetectionsReceivedAfter(null)).toBe(0);

    const id = (await repository.start(newRun({ startedAt: minutes(5) })))!;
    await repository.fail(id, 'X', 'failed', minutes(6));
    expect(await repository.findLastFinishedStart()).toBeNull();

    const good = (await repository.start(newRun({ startedAt: minutes(10) })))!;
    await repository.finish(good, STATS, minutes(11));
    expect(await repository.findLastFinishedStart()).toEqual(minutes(10));
  });
});

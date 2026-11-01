import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error.js';
import type {
  RoadGraphRepository,
  RoadGraphSnapshot,
} from '../repositories/road-graph.repository.js';
import { RoadGraphService } from './road-graph.service.js';

const snapshot: RoadGraphSnapshot = {
  version: '80b10dcac4b8843534b0cfd8439ac12f',
  nodes: [
    { id: 11, latitude: 1.214, longitude: -77.281 },
    { id: 12, latitude: 1.2141, longitude: -77.28 },
  ],
  segments: [
    { id: 7, fromNodeId: 11, toNodeId: 12, lengthM: 112, damageScore: 2, isOneway: false },
  ],
};

function createService(repository: Partial<RoadGraphRepository>) {
  return new RoadGraphService(repository as RoadGraphRepository);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RoadGraphService', () => {
  it('returns the snapshot read from the repository as it is', async () => {
    const getSnapshot = vi.fn(async () => snapshot);
    const graph = await createService({ getSnapshot }).getGraph();

    expect(graph).toEqual(snapshot);
    expect(getSnapshot).toHaveBeenCalledOnce();
  });

  it('returns the exact version from the repository', async () => {
    const getVersion = vi.fn(async () => snapshot.version);
    await expect(createService({ getVersion }).getVersion()).resolves.toBe(snapshot.version);
  });

  it('turns a database failure while reading the graph into a 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = createService({
      getSnapshot: vi.fn(async () => {
        throw new Error('connection refused');
      }),
    });

    const error = await service.getGraph().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'The database is not available right now',
    });
  });

  it('turns a database failure while reading the version into a 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = createService({
      getVersion: vi.fn(async () => {
        throw new Error('timeout');
      }),
    });

    await expect(service.getVersion()).rejects.toMatchObject({
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
    });
  });

  it('logs the original error so a real bug stays visible', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cause = new Error('syntax error in query');
    const service = createService({
      getSnapshot: vi.fn(async () => {
        throw cause;
      }),
    });

    await service.getGraph().catch(() => {});

    expect(log).toHaveBeenCalledWith('Could not read the road graph:', cause);
  });
});

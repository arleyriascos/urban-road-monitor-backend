import { describe, expect, it, vi } from 'vitest';
import type { RoadPlace } from '../roads/road-search-index.js';
import { RoadSearchService, SEARCH_CHECK_TTL_MS } from './road-search.service.js';

function place(roadId: number, name: string): RoadPlace {
  return {
    roadId,
    name,
    segments: 2,
    minLatitude: 1.2,
    maxLatitude: 1.21,
    minLongitude: -77.3,
    maxLongitude: -77.29,
  };
}

function setup(initial: RoadPlace[] = [place(1, 'Calle 18'), place(2, 'Carrera 9')]) {
  let roads = initial;
  let stamp = 'one';
  let now = 0;
  const repository = {
    findAll: vi.fn(async () => roads),
    findStamp: vi.fn(async () => stamp),
  };
  const service = new RoadSearchService({ roads: repository, clock: () => now });
  return {
    service,
    repository,
    change(next: RoadPlace[], nextStamp: string) {
      roads = next;
      stamp = nextStamp;
    },
    advance: (ms: number) => (now += ms),
  };
}

describe('RoadSearchService', () => {
  it('suggests the streets that start with what was typed', async () => {
    const { service } = setup();
    const found = await service.search('cal');
    expect(found.map((m) => m.name)).toEqual(['Calle 18']);
    expect(found[0]).toMatchObject({ roadIds: [1], segments: 2 });
  });

  it('limits the suggestions', async () => {
    const { service } = setup();
    expect(await service.search('c', 1)).toHaveLength(1);
    expect(await service.search('c')).toHaveLength(2);
  });

  it('reads the roads once and then only asks for the stamp when the check expires', async () => {
    const { service, repository, advance } = setup();
    await service.search('c');
    await service.search('c');
    expect(repository.findStamp).toHaveBeenCalledTimes(1);

    advance(SEARCH_CHECK_TTL_MS + 1);
    await service.search('c');
    expect(repository.findStamp).toHaveBeenCalledTimes(2);
    expect(repository.findAll).toHaveBeenCalledTimes(1); // the stamp did not change
  });

  it('builds the index again when the stamp changes', async () => {
    const { service, repository, change, advance } = setup();
    await service.search('c');
    change([place(3, 'Plaza Nariño')], 'two');
    advance(SEARCH_CHECK_TTL_MS + 1);

    expect((await service.search('plaza')).map((m) => m.name)).toEqual(['Plaza Nariño']);
    expect(await service.search('calle')).toEqual([]);
    expect(repository.findAll).toHaveBeenCalledTimes(2);
  });

  it('shares one check between requests that arrive together', async () => {
    const { service, repository } = setup();
    await Promise.all([service.search('c'), service.search('ca'), service.search('car')]);
    expect(repository.findStamp).toHaveBeenCalledTimes(1);
    expect(repository.findAll).toHaveBeenCalledTimes(1);
  });

  it('answers 503 when the database fails, and tries again on the next request', async () => {
    const { service, repository } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    repository.findStamp.mockRejectedValueOnce(new Error('down'));

    await expect(service.search('c')).rejects.toMatchObject({
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
    });
    expect(await service.search('c')).toHaveLength(2);
  });
});

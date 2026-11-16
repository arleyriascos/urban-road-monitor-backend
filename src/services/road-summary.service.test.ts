import { describe, expect, it, vi } from 'vitest';
import type { SegmentFacts } from '../roads/stretch-summary.js';
import { RoadSummaryService } from './road-summary.service.js';

function street(
  roadId: number,
  count: number,
  damage: Record<number, number> = {},
): SegmentFacts[] {
  return Array.from({ length: count }, (_, i) => ({
    segmentId: roadId * 100 + i,
    roadId,
    roadName: `Calle ${roadId}`,
    segmentIndex: i,
    lengthM: 100.005,
    visiblePotholes: damage[i] ? 1 : 0,
    confirmedPotholes: damage[i] ? 1 : 0,
    damageScore: damage[i] ?? 0,
    worstSeverity: damage[i] ? { name: 'grave', weight: 6 } : null,
  }));
}

function setup(initial: SegmentFacts[] = street(1, 6, { 2: 0.1 + 0.2 })) {
  let facts = initial;
  let stamp = 'one';
  let now = 0;
  const repository = {
    findAll: vi.fn(async () => facts),
    findStamp: vi.fn(async () => stamp),
  };
  const service = new RoadSummaryService({ facts: repository, clock: () => now });
  return {
    service,
    repository,
    change(next: SegmentFacts[], nextStamp: string) {
      facts = next;
      stamp = nextStamp;
    },
    advance: (ms: number) => (now += ms),
  };
}

describe('RoadSummaryService', () => {
  describe('segmentWindow', () => {
    it('gives the segment, the stretch around it and the whole street', async () => {
      const { service } = setup();
      const answer = await service.segmentWindow(102, 1);

      expect(answer.segment).toEqual({
        id: 102,
        roadId: 1,
        roadName: 'Calle 1',
        position: 3,
        segmentsInRoad: 6,
      });
      expect(answer.radius).toBe(1);
      expect(answer.window).toMatchObject({ fromSegmentIndex: 1, toSegmentIndex: 3 });
      expect(answer.window.summary).toMatchObject({
        segments: 3,
        confirmedPotholes: 1,
        damageScore: 0.3,
      });
      expect(answer.road.summary).toMatchObject({ segments: 6, lengthM: 600.03 });
    });

    it('answers 404 for a segment that does not exist', async () => {
      const { service } = setup();
      await expect(service.segmentWindow(9999, 2)).rejects.toMatchObject({
        statusCode: 404,
        code: 'SEGMENT_NOT_FOUND',
      });
    });
  });

  describe('road', () => {
    it('gives a whole street, or the segments between two indexes', async () => {
      const { service } = setup();
      expect((await service.road(1)).summary.segments).toBe(6);
      const part = await service.road(1, { from: 1, to: 3 });
      expect(part).toMatchObject({ fromSegmentIndex: 1, toSegmentIndex: 3 });
      expect(part.summary.segments).toBe(3);
    });

    it('answers 404 for a street that does not exist', async () => {
      const { service } = setup();
      await expect(service.road(77)).rejects.toMatchObject({
        statusCode: 404,
        code: 'ROAD_NOT_FOUND',
      });
    });
  });

  describe('streetsOfRoute', () => {
    it('describes the streets of a route', async () => {
      const { service } = setup();
      const streets = await service.streetsOfRoute([
        { order: 1, segmentId: 101 },
        { order: 2, segmentId: 102 },
        { order: 3, segmentId: 103 },
      ]);
      expect(streets).toHaveLength(1);
      expect(streets[0]).toMatchObject({ roadName: 'Calle 1', fromOrder: 1, toOrder: 3, steps: 3 });
      expect(streets[0]?.summary).toMatchObject({
        segments: 3,
        confirmedPotholes: 1,
        damageScore: 0.3,
      });
    });

    it('answers 503 when the database fails', async () => {
      const { service, repository } = setup();
      repository.findStamp.mockRejectedValueOnce(new Error('down'));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await expect(service.streetsOfRoute([{ order: 1, segmentId: 101 }])).rejects.toMatchObject({
        statusCode: 503,
      });
    });
  });

  describe('freshness', () => {
    it('reads the streets once and checks only the stamp until the time to live passes', async () => {
      const { service, repository, advance } = setup();
      await service.road(1);
      await service.road(1);
      advance(9_000);
      await service.road(1);
      expect(repository.findAll).toHaveBeenCalledTimes(1);
      expect(repository.findStamp).toHaveBeenCalledTimes(1);

      advance(2_000);
      await service.road(1);
      expect(repository.findStamp).toHaveBeenCalledTimes(2);
      expect(repository.findAll).toHaveBeenCalledTimes(1); // the stamp did not change
    });

    it('builds the index again when the stamp changes', async () => {
      const { service, repository, change, advance } = setup();
      expect((await service.road(1)).summary.confirmedPotholes).toBe(1);

      change(street(1, 6, { 0: 6, 2: 0.3, 4: 2 }), 'two');
      advance(11_000);

      expect((await service.road(1)).summary.confirmedPotholes).toBe(3);
      expect(repository.findAll).toHaveBeenCalledTimes(2);
    });

    it('shares one check among the requests that arrive together', async () => {
      const { service, repository } = setup();
      await Promise.all([service.road(1), service.road(1), service.segmentWindow(100, 1)]);
      expect(repository.findStamp).toHaveBeenCalledTimes(1);
      expect(repository.findAll).toHaveBeenCalledTimes(1);
    });

    it('answers 503 when the database fails, and tries again on the next request', async () => {
      const { service, repository } = setup();
      repository.findStamp.mockRejectedValueOnce(new Error('down'));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(service.road(1)).rejects.toMatchObject({
        statusCode: 503,
        code: 'DATABASE_UNAVAILABLE',
      });
      await expect(service.road(1)).resolves.toMatchObject({ roadId: 1 });
    });
  });
});

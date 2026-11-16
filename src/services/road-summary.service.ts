import { AppError } from '../errors/app-error.js';
import { RoadIndex, type RoadStretch } from '../roads/road-index.js';
import { groupRouteStreets, type RouteStepRef, type RouteStreet } from '../roads/route-streets.js';
import { roundSummary, type StretchSummary } from '../roads/stretch-summary.js';
import {
  roadFactsRepository,
  type RoadFactsRepository,
} from '../repositories/road-facts.repository.js';
import { orUnavailable } from './database-errors.js';

/** How often the database is asked whether potholes or segments changed. */
export const SUMMARY_CHECK_TTL_MS = 10_000;

export interface SummaryDependencies {
  facts: Pick<RoadFactsRepository, 'findAll' | 'findStamp'>;
  clock: () => number;
  ttlMs: number;
  index: RoadIndex;
}

export interface StretchAnswer {
  roadId: number;
  roadName: string | null;
  /** The first and the last segment index that were added up; null for an empty stretch. */
  fromSegmentIndex: number | null;
  toSegmentIndex: number | null;
  summary: StretchSummary;
}

export interface SegmentWindowAnswer {
  segment: {
    id: number;
    roadId: number;
    roadName: string | null;
    /** The place of the segment in its street, from 1, and how many segments the street has. */
    position: number;
    segmentsInRoad: number;
  };
  radius: number;
  /** The segment and the `radius` segments before and after it. */
  window: StretchAnswer;
  /** The whole street. */
  road: StretchAnswer;
}

/**
 * Answers "how are the potholes of this stretch of street?" with the segment trees of the
 * RoadIndex. The index is kept in memory and checked against the database every 10 seconds with a
 * cheap query: it is built again only when the segments or the potholes changed, so a
 * consolidation reaches the answers within 10 seconds. Requests that arrive while it is being
 * checked share one check. A check that fails is not kept: the next request tries again.
 */
export class RoadSummaryService {
  private readonly deps: SummaryDependencies;
  private stamp: string | null = null;
  private checkedAt = Number.NEGATIVE_INFINITY;
  private pending: Promise<void> | null = null;

  constructor(deps?: Partial<SummaryDependencies>) {
    this.deps = {
      facts: roadFactsRepository,
      clock: Date.now,
      ttlMs: SUMMARY_CHECK_TTL_MS,
      index: new RoadIndex(),
      ...deps,
    };
  }

  /** The segment, the stretch around it and its whole street. */
  async segmentWindow(segmentId: number, radius: number): Promise<SegmentWindowAnswer> {
    const index = await this.ready();
    const window = index.around(segmentId, radius);
    const road = window ? index.road(window.roadId) : undefined;
    const position = index.positionOf(segmentId);
    if (!window || !road || position === undefined) {
      throw new AppError(404, 'SEGMENT_NOT_FOUND', 'There is no segment with that id');
    }
    return {
      segment: {
        id: segmentId,
        roadId: window.roadId,
        roadName: window.roadName,
        position: position + 1,
        segmentsInRoad: road.summary.segments,
      },
      radius,
      window: present(window),
      road: present(road),
    };
  }

  /** A whole street, or only the segments between two indexes (both included). */
  async road(roadId: number, range?: { from: number; to: number }): Promise<StretchAnswer> {
    const index = await this.ready();
    const stretch = range ? index.stretch(roadId, range.from, range.to) : index.road(roadId);
    if (!stretch) {
      throw new AppError(404, 'ROAD_NOT_FOUND', 'There is no street with that id');
    }
    return present(stretch);
  }

  /** The streets a route follows, in order, with the potholes along each part. */
  async streetsOfRoute(steps: readonly RouteStepRef[]): Promise<RouteStreet[]> {
    return groupRouteStreets(steps, await this.ready());
  }

  /** The index, brought up to date if the last check is older than the time to live. */
  private async ready(): Promise<RoadIndex> {
    return orUnavailable('Could not read the streets', async () => {
      if (this.stamp === null || this.deps.clock() - this.checkedAt >= this.deps.ttlMs) {
        this.pending ??= this.refresh().finally(() => {
          this.pending = null;
        });
        await this.pending;
      }
      return this.deps.index;
    });
  }

  private async refresh(): Promise<void> {
    const stamp = await this.deps.facts.findStamp();
    if (stamp !== this.stamp) {
      this.deps.index.sync(await this.deps.facts.findAll());
      this.stamp = stamp;
    }
    this.checkedAt = this.deps.clock();
  }
}

function present(stretch: RoadStretch): StretchAnswer {
  return { ...stretch, summary: roundSummary(stretch.summary) };
}

export const roadSummaryService = new RoadSummaryService();

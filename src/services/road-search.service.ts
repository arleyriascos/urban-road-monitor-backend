import { RoadSearchIndex, type StreetMatch } from '../roads/road-search-index.js';
import {
  roadSearchRepository,
  type RoadSearchRepository,
} from '../repositories/road-search.repository.js';
import { orUnavailable } from './database-errors.js';

/** The streets change only when the road network is imported, so a check every minute is enough. */
export const SEARCH_CHECK_TTL_MS = 60_000;

export const DEFAULT_SUGGESTIONS = 8;

export interface SearchDependencies {
  roads: Pick<RoadSearchRepository, 'findAll' | 'findStamp'>;
  clock: () => number;
  ttlMs: number;
  index: RoadSearchIndex;
}

/**
 * Suggests streets by the beginning of their name. The trie lives here, in the backend: the
 * frontend only shows the suggestions and centers the map on the one that is picked. The index
 * is checked against the database at most once per minute and built again only if the roads
 * changed. Requests that arrive during a check share it, and a failed check is not kept.
 */
export class RoadSearchService {
  private readonly deps: SearchDependencies;
  private stamp: string | null = null;
  private checkedAt = Number.NEGATIVE_INFINITY;
  private pending: Promise<void> | null = null;

  constructor(deps?: Partial<SearchDependencies>) {
    this.deps = {
      roads: roadSearchRepository,
      clock: Date.now,
      ttlMs: SEARCH_CHECK_TTL_MS,
      index: new RoadSearchIndex(),
      ...deps,
    };
  }

  async search(query: string, limit = DEFAULT_SUGGESTIONS): Promise<StreetMatch[]> {
    const index = await this.ready();
    return index.search(query, limit);
  }

  private async ready(): Promise<RoadSearchIndex> {
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
    const stamp = await this.deps.roads.findStamp();
    if (stamp !== this.stamp) {
      this.deps.index.build(await this.deps.roads.findAll());
      this.stamp = stamp;
    }
    this.checkedAt = this.deps.clock();
  }
}

export const roadSearchService = new RoadSearchService();

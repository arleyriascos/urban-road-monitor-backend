import { roadGraphService } from './road-graph.service.js';

export const VERSION_TTL_MS = 10_000;

/**
 * The version of the road network, kept in memory for 10 seconds.
 *
 * Computing the exact version reads the whole graph in the database (about 30 ms plus
 * the network), and every route request needs it before looking at the cache. So it is
 * reused for 10 s: a change of damage reaches the routes within 10 s at most.
 *
 * Requests that arrive when the version has expired share one computation instead of
 * starting their own. A failed computation is not kept, so the next request tries again.
 */
export class NetworkVersionCache {
  private version: string | null = null;
  private computedAt = 0;
  private pending: Promise<string> | null = null;

  constructor(
    private readonly compute: () => Promise<string> = () => roadGraphService.getVersion(),
    private readonly ttlMs = VERSION_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async current(): Promise<string> {
    if (this.version !== null && this.now() - this.computedAt < this.ttlMs) {
      return this.version;
    }
    this.pending ??= this.compute()
      .then((version) => {
        this.version = version;
        this.computedAt = this.now();
        return version;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
}

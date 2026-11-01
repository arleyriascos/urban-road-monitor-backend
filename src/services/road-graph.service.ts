import { AppError } from '../errors/app-error.js';
import {
  roadGraphRepository,
  type RoadGraphRepository,
  type RoadGraphSnapshot,
} from '../repositories/road-graph.repository.js';

export type RoadGraph = RoadGraphSnapshot;

/**
 * Gives the AI service the road graph it computes routes on, and the version that tells
 * it when to reload. Database failures become a 503, so the AI service can retry later.
 */
export class RoadGraphService {
  constructor(private readonly repository: RoadGraphRepository = roadGraphRepository) {}

  async getGraph(): Promise<RoadGraph> {
    try {
      return await this.repository.getSnapshot();
    } catch (error) {
      throw databaseUnavailable('Could not read the road graph:', error);
    }
  }

  /** Exact version of the graph. The route endpoint keeps it in memory for a few seconds. */
  async getVersion(): Promise<string> {
    try {
      return await this.repository.getVersion();
    } catch (error) {
      throw databaseUnavailable('Could not read the road graph version:', error);
    }
  }
}

function databaseUnavailable(context: string, error: unknown): AppError {
  // Logged so a real bug (for example in a query) is still visible in the server logs.
  console.error(context, error);
  return new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not available right now');
}

export const roadGraphService = new RoadGraphService();

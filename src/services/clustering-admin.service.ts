import { AppError } from '../errors/app-error.js';
import {
  clusteringRunRepository,
  type ClusteringRunRepository,
  type RunRow,
} from '../repositories/clustering-run.repository.js';
import {
  consolidationCoordinator,
  type ConsolidationCoordinator,
  type CoordinatorStatus,
} from './consolidation-coordinator.js';
import { orUnavailable } from './database-errors.js';

export interface ClusteringOverview {
  status: CoordinatorStatus;
  runs: RunRow[];
}

/** What the administrator can do with the consolidation: start a run, and see how it goes. */
export class ClusteringAdminService {
  constructor(
    private readonly coordinator: Pick<
      ConsolidationCoordinator,
      'requestManual' | 'status'
    > = consolidationCoordinator,
    private readonly runs: Pick<ClusteringRunRepository, 'list'> = clusteringRunRepository,
  ) {}

  /** Starts a run now. The run goes on in the background; GET shows how it ends. */
  requestRun(requestedBy: string): void {
    const started = this.coordinator.requestManual(requestedBy);
    if (started === 'not_configured') {
      throw new AppError(
        503,
        'CLUSTERING_UNAVAILABLE',
        'Potholes cannot be grouped: the AI service is not configured',
        { retryable: false },
      );
    }
    if (started === 'busy') {
      throw new AppError(409, 'RUN_IN_PROGRESS', 'A consolidation is already running');
    }
  }

  /** The state of the consolidation and the latest runs, newest first. */
  async overview(limit: number): Promise<ClusteringOverview> {
    return orUnavailable('Could not read the consolidation runs', async () => ({
      status: await this.coordinator.status(),
      runs: await this.runs.list(limit),
    }));
  }
}

export const clusteringAdminService = new ClusteringAdminService();

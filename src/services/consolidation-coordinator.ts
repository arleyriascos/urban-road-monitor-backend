import {
  clusteringRunRepository,
  type ClusteringRunRepository,
} from '../repositories/clustering-run.repository.js';
import {
  parameterRepository,
  type ParameterRepository,
} from '../repositories/parameter.repository.js';
import { consolidationService, type ConsolidationService } from './consolidation.service.js';

/** Detections that arrive together (a phone sends batches every few seconds) share one run. */
export const BATCH_DELAY_MS = 5_000;
/** The server waits this long after it starts before looking for detections nobody grouped. */
export const STARTUP_DELAY_MS = 30_000;
export const DEFAULT_MIN_INTERVAL_S = 120;
/** How long to wait after a run that failed: 5, 10, 20 and then 30 minutes. */
export const RETRY_PAUSES_MS: readonly number[] = [5, 10, 20, 30].map(
  (minutes) => minutes * 60_000,
);

export interface ScheduledTimer {
  cancel(): void;
}

export interface CoordinatorDependencies {
  service: Pick<ConsolidationService, 'run' | 'isConfigured'>;
  parameters: Pick<ParameterRepository, 'getNumber'>;
  runs: Pick<ClusteringRunRepository, 'findLastFinishedStart' | 'countDetectionsReceivedAfter'>;
  clock: () => number;
  schedule: (action: () => void, delayMs: number) => ScheduledTimer;
}

export type ManualStart = 'started' | 'busy' | 'not_configured';

export interface CoordinatorStatus {
  /** A run is going on in this server right now. */
  running: boolean;
  /** When the next automatic run is planned, or null if none is. */
  nextRunAt: Date | null;
  /** Runs that failed one after another since the last good one. */
  failuresInARow: number;
  /** Detections that arrived after the last good run began. */
  pendingDetections: number;
}

/**
 * Decides when a consolidation runs. Nothing here groups anything: it only starts the service.
 *
 * - When detections are stored it plans a run, in a few seconds, but never sooner than two
 *   minutes (a parameter) after the last one began. Detections that arrive meanwhile share it.
 * - Only one run goes on at a time. What arrives during a run asks for the next one.
 * - A run that fails (the AI service is asleep or down, the database failed) is tried again
 *   after 5, 10, 20 and then every 30 minutes, until one works. The detections wait, safe in
 *   the table: nothing is lost.
 * - When the server starts it looks for detections that arrived after the last good run (a
 *   deploy can interrupt the plan) and plans a run for them.
 * - The administrator's button starts a run at once, without waiting for the pause.
 */
export class ConsolidationCoordinator {
  private readonly deps: CoordinatorDependencies;
  private running = false;
  private dirty = false;
  private timer: ScheduledTimer | null = null;
  private nextRunAt: number | null = null;
  private lastStartedAt: number | null = null;
  /** No run is started before this time (the pause after a failure, or after startup). */
  private notBefore = 0;
  private failures = 0;
  private stopped = false;
  private currentRun: Promise<void> = Promise.resolve();

  constructor(deps?: Partial<CoordinatorDependencies>) {
    this.deps = {
      service: consolidationService,
      parameters: parameterRepository,
      runs: clusteringRunRepository,
      clock: Date.now,
      schedule: (action, delayMs) => {
        const timer = setTimeout(action, delayMs);
        timer.unref();
        return { cancel: () => clearTimeout(timer) };
      },
      ...deps,
    };
  }

  /** New detections were stored. It never throws and never waits: it only plans. */
  notify(): void {
    if (this.stopped || !this.deps.service.isConfigured) {
      return;
    }
    this.dirty = true;
    void this.plan();
  }

  /** At startup: plans a run if some detections were never grouped. */
  async start(): Promise<void> {
    if (this.stopped || !this.deps.service.isConfigured) {
      return;
    }
    try {
      const lastGood = await this.deps.runs.findLastFinishedStart();
      if ((await this.deps.runs.countDetectionsReceivedAfter(lastGood)) > 0) {
        this.dirty = true;
        this.notBefore = Math.max(this.notBefore, this.deps.clock() + STARTUP_DELAY_MS);
        await this.plan();
      }
    } catch (error) {
      console.error('Could not look for detections that were never grouped:', error);
    }
  }

  /** The administrator's button. It answers at once; the run goes on in the background. */
  requestManual(requestedBy: string): ManualStart {
    if (!this.deps.service.isConfigured) {
      return 'not_configured';
    }
    if (this.running) {
      return 'busy';
    }
    this.cancelTimer();
    this.currentRun = this.execute('manual', requestedBy);
    return 'started';
  }

  async status(): Promise<CoordinatorStatus> {
    const lastGood = await this.deps.runs.findLastFinishedStart();
    return {
      running: this.running,
      nextRunAt: this.nextRunAt === null ? null : new Date(this.nextRunAt),
      failuresInARow: this.failures,
      pendingDetections: await this.deps.runs.countDetectionsReceivedAfter(lastGood),
    };
  }

  /** Stops planning runs (the server is shutting down) and waits for the one that is going on. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.cancelTimer();
    await this.currentRun;
  }

  private async plan(): Promise<void> {
    if (this.stopped || this.running || this.timer !== null || !this.dirty) {
      return;
    }
    let intervalMs = DEFAULT_MIN_INTERVAL_S * 1000;
    try {
      intervalMs =
        1000 *
        (await this.deps.parameters.getNumber('clustering_min_interval_s', DEFAULT_MIN_INTERVAL_S));
    } catch {
      // The default is fine: a database that does not answer must not stop the plan.
    }
    // The wait above may have let another call plan or start a run.
    if (this.stopped || this.running || this.timer !== null || !this.dirty) {
      return;
    }
    const now = this.deps.clock();
    const afterInterval = this.lastStartedAt === null ? 0 : this.lastStartedAt + intervalMs;
    const at = Math.max(now + BATCH_DELAY_MS, afterInterval, this.notBefore);
    this.nextRunAt = at;
    this.timer = this.deps.schedule(() => {
      this.timer = null;
      this.nextRunAt = null;
      this.currentRun = this.execute('automatic', null);
    }, at - now);
  }

  private async execute(
    trigger: 'automatic' | 'manual',
    requestedBy: string | null,
  ): Promise<void> {
    this.running = true;
    this.dirty = false; // what arrives from now on asks for another run
    this.lastStartedAt = this.deps.clock();
    try {
      const outcome = await this.deps.service.run(trigger, requestedBy);
      if (outcome.kind === 'finished') {
        this.failures = 0;
        this.notBefore = 0;
      } else if (outcome.kind === 'busy') {
        this.dirty = true; // another server is running; try again after the pause
      } else if (outcome.kind === 'failed') {
        this.dirty = true;
        const pause = RETRY_PAUSES_MS[Math.min(this.failures, RETRY_PAUSES_MS.length - 1)] ?? 0;
        this.failures += 1;
        this.notBefore = this.deps.clock() + pause;
        console.warn(
          `Consolidation failed (${outcome.code}); trying again in ${pause / 60_000} minutes`,
        );
      }
    } catch (error) {
      console.error('Consolidation stopped unexpectedly:', error);
      this.dirty = true;
      this.notBefore = this.deps.clock() + (RETRY_PAUSES_MS[0] ?? 0);
    } finally {
      this.running = false;
      void this.plan();
    }
  }

  private cancelTimer(): void {
    this.timer?.cancel();
    this.timer = null;
    this.nextRunAt = null;
  }
}

export const consolidationCoordinator = new ConsolidationCoordinator();

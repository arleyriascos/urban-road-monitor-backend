import type { TargetDescription } from '../config/database-target.js';
import { assertSeedAllowed } from '../seed/guards.js';
import { planSeed } from '../seed/plan.js';
import { formatSeedReport } from '../seed/report.js';
import { PASTO_CENTER } from '../seed/corridors.js';
import type { SeedCatalogs, SeedPlan, SeedSegment, SeedSummary } from '../seed/types.js';

/** Where the test potholes are read from and written to. The real one uses PostgreSQL. */
export interface PotholeSeedStore {
  describeTarget(): TargetDescription;
  countDetections(): Promise<number>;
  loadInput(): Promise<{ segments: SeedSegment[]; catalogs: SeedCatalogs }>;
  replaceAll(plan: SeedPlan): Promise<SeedSummary>;
}

export interface PotholeSeedDependencies {
  store: PotholeSeedStore;
  /** Asks the person to confirm the database that will be written. */
  confirm?(target: TargetDescription): Promise<boolean>;
  log?(message: string): void;
  /** NODE_ENV and SEED_ALLOWED_HOST of the process. */
  environment: { nodeEnv: string; allowedHost: string | undefined };
  now?: () => Date;
}

export interface SeedRunOptions {
  dryRun: boolean;
  count: number;
  seed: number;
}

export type SeedOutcome =
  | { status: 'dry-run'; report: string; plan: SeedPlan }
  | { status: 'cancelled'; report: string; plan: SeedPlan }
  | { status: 'saved'; report: string; plan: SeedPlan; summary: SeedSummary };

/** Creates invented potholes so the map and the routes can be tried before real data exists. */
export class PotholeSeedService {
  constructor(private readonly dependencies: PotholeSeedDependencies) {}

  async run(options: SeedRunOptions): Promise<SeedOutcome> {
    const { store, confirm, environment } = this.dependencies;
    const log = this.dependencies.log ?? (() => undefined);
    const now = this.dependencies.now ?? (() => new Date());
    const target = store.describeTarget();

    if (!options.dryRun) {
      if (!confirm) throw new Error('Para crear los baches hace falta la confirmación');
      assertSeedAllowed({
        nodeEnv: environment.nodeEnv,
        allowedHost: environment.allowedHost,
        targetHost: target.host,
        detections: await store.countDetections(),
      });
    }

    const { segments, catalogs } = await store.loadInput();
    if (segments.length === 0) {
      throw new Error('No hay tramos en la base de datos. Importa primero la red vial.');
    }

    const plan = planSeed(segments, catalogs, {
      count: options.count,
      seed: options.seed,
      now: now(),
      center: PASTO_CENTER,
    });
    const report = formatSeedReport(plan);
    log(`\n${report}`);

    if (options.dryRun) return { status: 'dry-run', report, plan };

    if (!confirm || !(await confirm(target))) return { status: 'cancelled', report, plan };

    log('\nCreando los baches de prueba...');
    const summary = await store.replaceAll(plan);
    return { status: 'saved', report, plan, summary };
  }
}

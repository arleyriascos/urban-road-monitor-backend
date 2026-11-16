import type { TargetDescription } from '../config/database-target.js';
import type { CleanupResult } from '../repositories/trip-cleanup.repository.js';
import type { CleanupCommand } from '../trips/cleanup-command.js';
import {
  formatCleanupPlan,
  planCleanup,
  type CleanupPlan,
  type CleanupTrip,
} from '../trips/cleanup-plan.js';

/** Where the trips are read from and deleted. The real one uses PostgreSQL. */
export interface CleanupStore {
  describeTarget(): TargetDescription;
  findAccount(email: string): Promise<{ id: string; email: string } | null>;
  listTrips(userId: string, since: Date | null): Promise<CleanupTrip[]>;
  deleteTrips(userId: string, tripIds: readonly string[]): Promise<CleanupResult>;
}

/** What the person sees before they are asked to confirm: nothing has been deleted yet. */
export interface CleanupPreview {
  target: TargetDescription;
  email: string;
  plan: CleanupPlan;
}

export interface CleanupDependencies {
  store: CleanupStore;
  /** Shows the preview, with the database it will delete from, and asks the person to confirm. */
  confirm(preview: CleanupPreview): Promise<boolean>;
}

export type CleanupOutcome =
  /** The trips were deleted. */
  | { status: 'deleted'; message: string }
  /** It only looked, as it was asked to (no --aplicar), or there was nothing to delete. */
  | { status: 'looked'; message: string }
  /** The person did not confirm: nothing was deleted. */
  | { status: 'cancelled'; message: string }
  /** The account does not exist: nothing was done. */
  | { status: 'refused'; message: string };

/**
 * Deletes the test trips of an account with the care a deletion deserves: it looks first and
 * says what would go and in WHICH database. Without --aplicar that is all it does. With it, it
 * waits for the confirmation and only then deletes, and nothing that has nothing to delete asks
 * a question. The repository checks again, inside the transaction, what it may delete.
 */
export class TripCleanupService {
  constructor(private readonly dependencies: CleanupDependencies) {}

  async run(command: CleanupCommand): Promise<CleanupOutcome> {
    const { store, confirm } = this.dependencies;
    const target = store.describeTarget();

    const account = await store.findAccount(command.email);
    if (!account) {
      return {
        status: 'refused',
        message: `No hay ninguna cuenta con el correo ${command.email} en ${target.database}.`,
      };
    }

    const plan = planCleanup(await store.listTrips(account.id, command.since));
    const description = formatCleanupPlan(account.email, plan);
    if (plan.deletable.length === 0) {
      return { status: 'looked', message: `${description}\nNo hay nada que borrar.` };
    }
    if (!command.apply) {
      return {
        status: 'looked',
        message: `${description}\n\nNo se borró nada. Para borrar, repite el comando con --aplicar.`,
      };
    }

    const confirmed = await confirm({ target, email: account.email, plan });
    if (!confirmed) {
      return { status: 'cancelled', message: 'Cancelado: no se borró nada.' };
    }

    const result = await store.deleteTrips(
      account.id,
      plan.deletable.map((trip) => trip.id),
    );
    return {
      status: 'deleted',
      message: `Listo: se borraron ${result.trips} viajes y ${result.detections} detecciones de ${account.email} en ${target.database}.`,
    };
  }
}

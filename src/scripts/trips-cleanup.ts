import { createInterface } from 'node:readline/promises';
import { isConfirmation } from '../auth/role-change-report.js';
import { describeDatabaseTarget } from '../config/database-target.js';
import {
  CLEANUP_COMMAND_HELP,
  CleanupCommandError,
  parseCleanupCommand,
  type CleanupCommand,
} from '../trips/cleanup-command.js';
import { formatCleanupPlan } from '../trips/cleanup-plan.js';
import { TripCleanupService, type CleanupPreview } from '../services/trip-cleanup.service.js';

async function askConfirmation(preview: CleanupPreview): Promise<boolean> {
  console.log(
    `\nBase de datos: ${preview.target.database} en ${preview.target.host}\n\n` +
      formatCleanupPlan(preview.email, preview.plan),
  );
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return isConfirmation(
      await readline.question('\nEscribe "SI" para borrar (otra cosa cancela): '),
    );
  } finally {
    readline.close();
  }
}

/** Returns true if the database was used, so the connection has to be closed at the end. */
async function main(): Promise<boolean> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(CLEANUP_COMMAND_HELP);
    return false;
  }

  let command: CleanupCommand;
  try {
    command = parseCleanupCommand(args);
  } catch (error) {
    if (error instanceof CleanupCommandError) {
      console.error(`\n${error.message}\n\n${CLEANUP_COMMAND_HELP}`);
      process.exitCode = 1;
      return false;
    }
    throw error;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Falta DATABASE_URL en el archivo .env: sin ella no se sabe qué base limpiar');
  }
  const target = describeDatabaseTarget(databaseUrl);

  const { tripCleanupRepository } = await import('../repositories/trip-cleanup.repository.js');
  const service = new TripCleanupService({
    store: {
      describeTarget: () => target,
      findAccount: (email) => tripCleanupRepository.findAccount(email),
      listTrips: (userId, since) => tripCleanupRepository.listTrips(userId, since),
      deleteTrips: (userId, tripIds) => tripCleanupRepository.deleteTrips(userId, tripIds),
    },
    confirm: askConfirmation,
  });

  // Before anything else, whatever the command is, say which database this is about.
  console.log(`Base de datos: ${target.database} en ${target.host}`);
  const outcome = await service.run(command);
  console.log(`\n${outcome.message}`);
  if (outcome.status === 'refused') process.exitCode = 1;
  return true;
}

let usedDatabase = false;
main()
  .then((used) => {
    usedDatabase = used;
  })
  .catch((error: unknown) => {
    console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    usedDatabase = true;
  })
  .finally(async () => {
    if (usedDatabase) {
      const { disconnectDatabase } = await import('../config/database.js');
      await disconnectDatabase();
    }
  });

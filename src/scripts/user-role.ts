import { createInterface } from 'node:readline/promises';
import { formatRoleChangePreview, isConfirmation } from '../auth/role-change-report.js';
import {
  parseRoleCommand,
  ROLE_COMMAND_HELP,
  RoleCommandError,
  type RoleCommand,
} from '../auth/role-command.js';
import { describeDatabaseTarget } from '../config/database-target.js';
import type { RoleChangePreview } from '../services/role-change.service.js';
import { RoleChangeService } from '../services/role-change.service.js';

async function askConfirmation(preview: RoleChangePreview): Promise<boolean> {
  console.log(`\n${formatRoleChangePreview(preview)}`);
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return isConfirmation(
      await readline.question('Escribe "SI" para continuar (otra cosa cancela): '),
    );
  } finally {
    readline.close();
  }
}

/** Returns true if the database was used, so the connection has to be closed at the end. */
async function main(): Promise<boolean> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(ROLE_COMMAND_HELP);
    return false;
  }

  let command: RoleCommand;
  try {
    command = parseRoleCommand(args);
  } catch (error) {
    if (error instanceof RoleCommandError) {
      console.error(`\n${error.message}\n\n${ROLE_COMMAND_HELP}`);
      process.exitCode = 1;
      return false;
    }
    throw error;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Falta DATABASE_URL en el archivo .env: sin ella no se sabe qué base cambiar');
  }
  const target = describeDatabaseTarget(databaseUrl);

  const { roleAdminRepository } = await import('../repositories/role-admin.repository.js');
  const service = new RoleChangeService({
    store: {
      describeTarget: () => target,
      findAccount: (email) => roleAdminRepository.findAccount(email),
      change: (changeCommand) => roleAdminRepository.change(changeCommand, new Date()),
    },
    confirm: askConfirmation,
  });

  const result = await service.run(command);
  console.log(`\n${result.message}`);
  if (result.status === 'refused') process.exitCode = 1;
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

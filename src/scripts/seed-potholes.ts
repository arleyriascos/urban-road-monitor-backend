import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import type { TargetDescription } from '../config/database-target.js';
import { formatSeedSummary } from '../seed/report.js';
import { PotholeSeedService } from '../services/pothole-seed.service.js';

const HELP = `Crea baches de prueba (inventados) para probar el mapa y las rutas.
SOLO para la rama development. Reemplaza todos los baches existentes.

Uso: npm run seed:potholes -- [opciones]

Opciones:
  --dry-run     Muestra el plan sin escribir nada en la base de datos
  --count N     Cantidad de baches (por defecto 60). Con 0 borra los baches de prueba y no crea ninguno
  --seed N      Semilla: la misma semilla crea siempre los mismos baches (por defecto 2026)
  --help        Muestra esta ayuda

Requiere SEED_ALLOWED_HOST en el archivo .env (ver docs/BACHES-DE-PRUEBA.md).`;

async function askConfirmation(target: TargetDescription): Promise<boolean> {
  console.log('\nVas a REEMPLAZAR TODOS los baches de esta base de datos:');
  console.log(`  Servidor: ${target.host}`);
  console.log(`  Base:     ${target.database}`);
  console.log('Estos baches son inventados. Nunca deben crearse en la rama main.');

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question('Escribe "si" para continuar (otra cosa cancela): ');
    return ['si', 'sí'].includes(answer.trim().toLowerCase());
  } finally {
    readline.close();
  }
}

function parseNonNegativeInteger(text: string, name: string): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} debe ser un número entero, igual o mayor que cero`);
  }
  return value;
}

async function main(): Promise<boolean> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      count: { type: 'string', default: '60' },
      seed: { type: 'string', default: '2026' },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    return false;
  }

  const count = parseNonNegativeInteger(values.count, '--count');
  const seed = parseNonNegativeInteger(values.seed, '--seed');

  const { PotholeSeedRepository } = await import('../repositories/pothole-seed.repository.js');
  const service = new PotholeSeedService({
    store: new PotholeSeedRepository(),
    confirm: askConfirmation,
    log: console.log,
    environment: {
      nodeEnv: process.env.NODE_ENV ?? 'development',
      allowedHost: process.env.SEED_ALLOWED_HOST,
    },
  });

  const outcome = await service.run({ dryRun: values['dry-run'], count, seed });

  if (outcome.status === 'dry-run') {
    console.log('\nModo de prueba: no se escribió nada en la base de datos.');
  } else if (outcome.status === 'cancelled') {
    console.log('\nCancelado: no se escribió nada en la base de datos.');
  } else {
    console.log(`\n${formatSeedSummary(outcome.summary)}`);
  }
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

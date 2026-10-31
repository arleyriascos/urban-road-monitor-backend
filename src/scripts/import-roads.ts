import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { parseBoundingBox } from '../osm/bbox.js';
import { DEFAULT_BBOX } from '../osm/config.js';
import { loadOverpassData } from '../osm/overpass-client.js';
import { formatSaveSummary } from '../osm/report.js';
import { RoadImportService, type TargetDescription } from '../services/road-import.service.js';

const HELP = `Importa la red vial de Pasto desde OpenStreetMap a la base de datos.

Uso: npm run import:roads -- [opciones]

Opciones:
  --dry-run        Descarga y cuenta, pero NO escribe nada en la base de datos
  --refresh        Vuelve a descargar aunque ya haya datos guardados en este computador
  --bbox S,O,N,E   Rectángulo a importar: sur,oeste,norte,este (por defecto, el casco urbano)
  --help           Muestra esta ayuda`;

async function askConfirmation(target: TargetDescription): Promise<boolean> {
  console.log('\nVas a ESCRIBIR en esta base de datos:');
  console.log(`  Servidor: ${target.host}`);
  console.log(`  Base:     ${target.database}`);
  console.log('Compara el servidor con el de la rama de Neon que vas a modificar (botón Connect).');

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question('Escribe "si" para continuar (otra cosa cancela): ');
    return ['si', 'sí'].includes(answer.trim().toLowerCase());
  } finally {
    readline.close();
  }
}

async function main(): Promise<boolean> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      refresh: { type: 'boolean', default: false },
      bbox: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    return false;
  }

  const bbox = values.bbox ? parseBoundingBox(values.bbox) : DEFAULT_BBOX;
  const dryRun = values['dry-run'];

  // The database is only loaded when something will be written, so --dry-run
  // works even without a DATABASE_URL.
  let store;
  if (!dryRun) {
    const { RoadNetworkRepository } = await import('../repositories/road-network.repository.js');
    store = new RoadNetworkRepository();
  }

  const service = new RoadImportService({
    loadData: (area, refresh) => loadOverpassData(area, { refresh, log: console.log }),
    store,
    confirm: askConfirmation,
    log: console.log,
  });

  const outcome = await service.run({ bbox, dryRun, refresh: values.refresh });

  if (outcome.status === 'dry-run') {
    console.log('\nModo de prueba: no se escribió nada en la base de datos.');
  } else if (outcome.status === 'cancelled') {
    console.log('\nCancelado: no se escribió nada en la base de datos.');
  } else {
    console.log(`\n${formatSaveSummary(outcome.summary)}`);
  }
  return !dryRun;
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

import type { TargetDescription } from '../config/database-target.js';
import { buildNetwork } from '../osm/segmentize.js';
import type { BoundingBox } from '../osm/config.js';
import type { LoadedOverpassData } from '../osm/overpass-client.js';
import { parseOverpassResponse } from '../osm/parse.js';
import { formatImportReport, type SaveSummary } from '../osm/report.js';
import type { NetworkDraft } from '../osm/types.js';

export type { TargetDescription };

/** Where the road network is saved. The real one writes to PostgreSQL. */
export interface RoadNetworkStore {
  describeTarget(): TargetDescription;
  save(network: NetworkDraft): Promise<SaveSummary>;
}

export interface RoadImportDependencies {
  loadData(bbox: BoundingBox, refresh: boolean): Promise<LoadedOverpassData>;
  /** Not needed in dry-run mode. */
  store?: RoadNetworkStore;
  /** Asks the person to confirm the database that will be written. */
  confirm?(target: TargetDescription): Promise<boolean>;
  log?(message: string): void;
}

export interface ImportOptions {
  bbox: BoundingBox;
  dryRun: boolean;
  refresh: boolean;
}

export type ImportOutcome =
  | { status: 'dry-run'; report: string }
  | { status: 'cancelled'; report: string }
  | { status: 'saved'; report: string; summary: SaveSummary };

/** Downloads (or reads) OpenStreetMap data, builds the graph and saves it. */
export class RoadImportService {
  constructor(private readonly dependencies: RoadImportDependencies) {}

  async run(options: ImportOptions): Promise<ImportOutcome> {
    const { bbox, dryRun, refresh } = options;
    const { store, confirm } = this.dependencies;
    const log = this.dependencies.log ?? (() => undefined);

    if (!dryRun && (!store || !confirm)) {
      throw new Error('Para guardar en la base de datos hacen falta el almacén y la confirmación');
    }

    const loaded = await this.dependencies.loadData(bbox, refresh);

    log('Interpretando los datos de OpenStreetMap...');
    const { ways, stats: parse } = parseOverpassResponse(loaded.response);
    const { network, stats: build } = buildNetwork(ways);

    const report = formatImportReport({
      bbox,
      source: loaded.source,
      cacheFile: loaded.cacheFile,
      sizeBytes: loaded.sizeBytes,
      parse,
      build,
    });
    log(`\n${report}`);

    if (dryRun) return { status: 'dry-run', report };

    if (network.roads.length === 0) {
      throw new Error('No se encontraron vías para importar; no se escribió nada.');
    }

    if (!store || !confirm || !(await confirm(store.describeTarget()))) {
      return { status: 'cancelled', report };
    }

    log('\nGuardando en la base de datos (puede tardar unos minutos)...');
    const summary = await store.save(network);
    return { status: 'saved', report, summary };
  }
}

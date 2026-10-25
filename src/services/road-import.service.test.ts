import { describe, expect, it, vi } from 'vitest';
import { loadSampleResponse } from '../osm/__fixtures__/sample.js';
import { DEFAULT_BBOX } from '../osm/config.js';
import type { LoadedOverpassData } from '../osm/overpass-client.js';
import type { SaveSummary } from '../osm/report.js';
import type { NetworkDraft } from '../osm/types.js';
import {
  RoadImportService,
  type RoadNetworkStore,
  type TargetDescription,
} from './road-import.service.js';

const summary: SaveSummary = {
  nodes: { inserted: 12, updated: 0 },
  roads: { inserted: 6, updated: 0 },
  segments: { inserted: 11, updated: 0 },
  staleSegmentsDeleted: 0,
  staleSegmentsKept: 0,
};

const target: TargetDescription = { host: 'fake-host', database: 'fake_db' };

class InMemoryStore implements RoadNetworkStore {
  saved: NetworkDraft[] = [];

  describeTarget(): TargetDescription {
    return target;
  }

  async save(network: NetworkDraft): Promise<SaveSummary> {
    this.saved.push(network);
    return summary;
  }
}

const sampleData: LoadedOverpassData = {
  response: loadSampleResponse(),
  source: 'cache',
  cacheFile: 'data/osm/sample.json',
  sizeBytes: 1234,
};

const options = { bbox: DEFAULT_BBOX, dryRun: false, refresh: false };

describe('RoadImportService', () => {
  it('only reports in dry-run mode and never touches the store', async () => {
    const store = new InMemoryStore();
    const confirm = vi.fn();
    const service = new RoadImportService({ loadData: async () => sampleData, store, confirm });

    const outcome = await service.run({ ...options, dryRun: true });

    expect(outcome.status).toBe('dry-run');
    expect(outcome.report).toContain('Vías que se importarán');
    expect(confirm).not.toHaveBeenCalled();
    expect(store.saved).toHaveLength(0);
  });

  it('works in dry-run mode without a store', async () => {
    const service = new RoadImportService({ loadData: async () => sampleData });
    const outcome = await service.run({ ...options, dryRun: true });
    expect(outcome.status).toBe('dry-run');
  });

  it('asks for confirmation with the target database and then saves', async () => {
    const store = new InMemoryStore();
    const confirm = vi.fn(async () => true);
    const service = new RoadImportService({ loadData: async () => sampleData, store, confirm });

    const outcome = await service.run(options);

    expect(confirm).toHaveBeenCalledWith(target);
    expect(outcome).toMatchObject({ status: 'saved', summary });
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0].roads).toHaveLength(6);
    expect(store.saved[0].nodes).toHaveLength(12);
  });

  it('saves nothing when the person does not confirm', async () => {
    const store = new InMemoryStore();
    const service = new RoadImportService({
      loadData: async () => sampleData,
      store,
      confirm: async () => false,
    });

    const outcome = await service.run(options);

    expect(outcome.status).toBe('cancelled');
    expect(store.saved).toHaveLength(0);
  });

  it('refuses to save without a store or without a confirmation', async () => {
    const service = new RoadImportService({ loadData: async () => sampleData });
    await expect(service.run(options)).rejects.toThrow('confirmación');
  });

  it('refuses to save an empty network', async () => {
    const store = new InMemoryStore();
    const confirm = vi.fn(async () => true);
    const service = new RoadImportService({
      loadData: async () => ({ ...sampleData, response: { elements: [] } }),
      store,
      confirm,
    });

    await expect(service.run(options)).rejects.toThrow('No se encontraron vías');
    expect(confirm).not.toHaveBeenCalled();
    expect(store.saved).toHaveLength(0);
  });

  it('passes the area and the refresh flag to the data loader', async () => {
    const loadData = vi.fn(async () => sampleData);
    const service = new RoadImportService({ loadData });

    await service.run({ ...options, dryRun: true, refresh: true });

    expect(loadData).toHaveBeenCalledWith(DEFAULT_BBOX, true);
  });

  it('logs the report', async () => {
    const log = vi.fn();
    const service = new RoadImportService({ loadData: async () => sampleData, log });

    await service.run({ ...options, dryRun: true });

    expect(log.mock.calls.flat().join('\n')).toContain('Resumen de la importación');
  });
});

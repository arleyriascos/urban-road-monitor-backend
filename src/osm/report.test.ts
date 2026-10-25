import { describe, expect, it } from 'vitest';
import { loadSampleResponse } from './__fixtures__/sample.js';
import { DEFAULT_BBOX } from './config.js';
import { parseOverpassResponse } from './parse.js';
import {
  formatBytes,
  formatDecimal,
  formatImportReport,
  formatNumber,
  formatSaveSummary,
} from './report.js';
import { buildNetwork } from './segmentize.js';

describe('number formatting', () => {
  it('uses dots as thousands separators', () => {
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(18_432)).toBe('18.432');
    expect(formatNumber(1_234_567)).toBe('1.234.567');
  });

  it('uses a comma as decimal separator', () => {
    expect(formatDecimal(612.4)).toBe('612,4');
    expect(formatDecimal(3, 2)).toBe('3,00');
  });

  it('shows sizes in B, KB and MB', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2,0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5,0 MB');
  });
});

describe('formatImportReport', () => {
  const parsed = parseOverpassResponse(loadSampleResponse());
  const built = buildNetwork(parsed.ways);
  const report = formatImportReport({
    bbox: DEFAULT_BBOX,
    source: 'download',
    cacheFile: 'data/osm/example.json',
    sizeBytes: 3 * 1024 * 1024,
    parse: parsed.stats,
    build: built.stats,
  });

  it('describes the area and where the data came from', () => {
    expect(report).toContain('sur 1.17, oeste -77.32, norte 1.25, este -77.24');
    expect(report).toContain('descarga nueva (3,0 MB)');
    expect(report).toContain('data/osm/example.json');
  });

  it('shows the counts of the sample data', () => {
    expect(report).toMatch(/Vías leídas\s+9\b/);
    expect(report).toMatch(/Vías que se importarán\s+6\b/);
    expect(report).toMatch(/Tramos\s+11\b/);
    expect(report).toMatch(/de un solo sentido\s+6\b/);
  });

  it('lists the roads of every type', () => {
    expect(report).toMatch(/residential\s+3\b/);
    expect(report).toMatch(/trunk\s+0\b/);
  });

  it('says when the data was read from the computer', () => {
    const cached = formatImportReport({
      bbox: DEFAULT_BBOX,
      source: 'cache',
      cacheFile: 'x.json',
      sizeBytes: 10,
      parse: parsed.stats,
      build: built.stats,
    });
    expect(cached).toContain('archivo guardado en este computador');
  });
});

describe('formatSaveSummary', () => {
  it('shows new and updated rows and the old segments', () => {
    const text = formatSaveSummary({
      nodes: { inserted: 12, updated: 0 },
      roads: { inserted: 1_500, updated: 20 },
      segments: { inserted: 3, updated: 2 },
      staleSegmentsDeleted: 4,
      staleSegmentsKept: 1,
    });
    expect(text).toContain('12 nuevos, 0 actualizados');
    expect(text).toContain('1.500 nuevos, 20 actualizados');
    expect(text).toContain('3 nuevos, 2 actualizados');
    expect(text).toContain('eliminados: 4');
    expect(text).toContain('conservados (tienen baches o rutas): 1');
  });
});

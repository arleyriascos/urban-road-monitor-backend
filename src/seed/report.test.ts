import { describe, expect, it } from 'vitest';
import { buildGrid, GRID_CENTER, testCatalogs } from './__fixtures__/grid.js';
import { planSeed } from './plan.js';
import { formatSeedReport, formatSeedSummary } from './report.js';

const plan = planSeed(buildGrid(), testCatalogs, {
  count: 60,
  seed: 2026,
  now: new Date('2026-10-25T12:00:00.000Z'),
  center: GRID_CENTER,
});

describe('formatSeedReport', () => {
  const report = formatSeedReport(plan);

  it('shows the totals', () => {
    expect(report).toContain('Plan de baches de prueba');
    expect(report).toMatch(/Baches\s+60\b/);
    expect(report).toMatch(/en corredores del centro\s+42\b/);
    expect(report).toMatch(/repartidos por la ciudad\s+18\b/);
  });

  it('shows the potholes by severity and by status', () => {
    expect(report).toMatch(/grave\s+\d+/);
    expect(report).toMatch(/sin confirmar\s+9\b/);
    expect(report).toMatch(/reparado\s+6\b/);
    expect(report).toMatch(/confirmado\s+45\b/);
  });

  it('lists every corridor with its alternatives', () => {
    for (const corridor of plan.corridors) expect(report).toContain(corridor.name);
    expect(report).toContain('alternativas');
  });
});

describe('formatSeedSummary', () => {
  it('shows what was written', () => {
    const text = formatSeedSummary({
      deletedPotholes: 12,
      insertedPotholes: 60,
      segmentsReset: 8,
      segmentsWithDamage: 41,
    });
    expect(text).toMatch(/Baches anteriores eliminados\s+12\b/);
    expect(text).toMatch(/Baches nuevos\s+60\b/);
    expect(text).toMatch(/Tramos con baches\s+41\b/);
  });
});

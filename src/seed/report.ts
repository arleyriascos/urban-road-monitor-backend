import { formatDecimal, formatNumber } from '../osm/report.js';
import type { PlannedPothole, SeedPlan, SeedSummary } from './types.js';

const row = (label: string, value: string): string => `  ${label.padEnd(36)}${value.padStart(8)}`;

function countBy(potholes: readonly PlannedPothole[], key: (pothole: PlannedPothole) => string) {
  const counts = new Map<string, number>();
  for (const pothole of potholes) counts.set(key(pothole), (counts.get(key(pothole)) ?? 0) + 1);
  return counts;
}

/** What the seed is going to create, in plain Spanish. */
export function formatSeedReport(plan: SeedPlan): string {
  const { potholes, corridors, segmentDamage } = plan;
  const inCorridors = potholes.filter((pothole) => pothole.inCorridor).length;
  const worst = Math.max(0, ...[...segmentDamage.values()].map((damage) => damage.damageScore));

  const lines = [
    'Plan de baches de prueba',
    row('Baches', formatNumber(potholes.length)),
    row('  en corredores del centro', formatNumber(inCorridors)),
    row('  repartidos por la ciudad', formatNumber(potholes.length - inCorridors)),
    row('Tramos con baches', formatNumber(segmentDamage.size)),
    row('Mayor daño en un tramo (costo x)', formatDecimal(1 + worst, 2)),
    '',
    'Por severidad:',
  ];

  for (const [name, count] of countBy(potholes, (pothole) => pothole.severityName)) {
    lines.push(row(`  ${name}`, formatNumber(count)));
  }
  lines.push('', 'Por estado:');
  for (const [name, count] of countBy(potholes, (pothole) => pothole.statusName)) {
    lines.push(row(`  ${name}`, formatNumber(count)));
  }

  lines.push('', 'Corredores:');
  for (const corridor of corridors) {
    lines.push(
      row(`  ${corridor.name}`, `${corridor.potholes} (${corridor.alternatives} alternativas)`),
    );
  }

  return lines.join('\n');
}

export function formatSeedSummary(summary: SeedSummary): string {
  return [
    'Baches de prueba creados',
    row('Baches anteriores eliminados', formatNumber(summary.deletedPotholes)),
    row('Baches nuevos', formatNumber(summary.insertedPotholes)),
    row('Tramos con baches', formatNumber(summary.segmentsWithDamage)),
    row('Tramos restablecidos a sin daño', formatNumber(summary.segmentsReset)),
  ].join('\n');
}

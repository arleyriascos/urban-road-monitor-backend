import { formatBoundingBox } from './bbox.js';
import type { BoundingBox } from './config.js';
import type { BuildStats, ParseStats } from './types.js';

/** Amounts of rows written to the database, split by new and updated. */
export interface SaveSummary {
  nodes: { inserted: number; updated: number };
  roads: { inserted: number; updated: number };
  segments: { inserted: number; updated: number };
  staleSegmentsDeleted: number;
  staleSegmentsKept: number;
}

export interface ReportInput {
  bbox: BoundingBox;
  source: 'cache' | 'download';
  cacheFile: string;
  sizeBytes: number;
  parse: ParseStats;
  build: BuildStats;
}

/** 18432 -> "18.432" (Spanish thousands separator, independent of the system locale). */
export function formatNumber(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 612.4 -> "612,4" */
export function formatDecimal(value: number, digits = 1): string {
  return value.toFixed(digits).replace('.', ',');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatDecimal(bytes / 1024)} KB`;
  return `${formatDecimal(bytes / (1024 * 1024))} MB`;
}

const row = (label: string, value: string): string => `  ${label.padEnd(44)}${value.padStart(10)}`;

export function formatImportReport(input: ReportInput): string {
  const { parse, build } = input;
  const origin =
    input.source === 'cache' ? 'archivo guardado en este computador' : 'descarga nueva';

  const lines = [
    'Resumen de la importación de OpenStreetMap',
    `  Área:   ${formatBoundingBox(input.bbox)}`,
    `  Datos:  ${origin} (${formatBytes(input.sizeBytes)})`,
    `          ${input.cacheFile}`,
    '',
    row('Vías leídas', formatNumber(parse.waysRead)),
    row('  descartadas por tipo de vía', formatNumber(parse.skippedType)),
    row('  descartadas por acceso (no o privado)', formatNumber(parse.skippedAccess)),
    row('  descartadas por datos incompletos', formatNumber(parse.skippedInvalid)),
    row('Vías que se importarán', formatNumber(build.roads)),
    '',
    row('Nodos (intersecciones y extremos)', formatNumber(build.nodes)),
    row('Tramos', formatNumber(build.segments)),
    row('  de un solo sentido', formatNumber(build.onewaySegments)),
    row('  descartados (sin longitud o en bucle)', formatNumber(build.skippedSegments)),
    row('Longitud total (km)', formatDecimal(build.totalLengthKm)),
    '',
    'Vías por tipo:',
  ];

  for (const [type, count] of Object.entries(build.roadsByType)) {
    lines.push(row(`  ${type}`, formatNumber(count)));
  }

  return lines.join('\n');
}

export function formatSaveSummary(summary: SaveSummary): string {
  const line = (label: string, counts: { inserted: number; updated: number }): string =>
    `  ${label.padEnd(10)}${formatNumber(counts.inserted)} nuevos, ${formatNumber(counts.updated)} actualizados`;

  return [
    'Importación terminada',
    line('Nodos', summary.nodes),
    line('Vías', summary.roads),
    line('Tramos', summary.segments),
    `  Tramos antiguos eliminados: ${formatNumber(summary.staleSegmentsDeleted)}`,
    `  Tramos antiguos conservados (tienen baches o rutas): ${formatNumber(summary.staleSegmentsKept)}`,
  ].join('\n');
}

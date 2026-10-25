import type { BoundingBox } from './config.js';

/** Reads "south,west,north,east" (the format of the --bbox option). */
export function parseBoundingBox(text: string): BoundingBox {
  const parts = text.split(',').map((part) => part.trim());

  if (parts.length !== 4 || parts.some((part) => part === '')) {
    throw new Error('El rectángulo debe tener 4 números separados por comas: sur,oeste,norte,este');
  }

  const [south, west, north, east] = parts.map(Number);

  if ([south, west, north, east].some((value) => !Number.isFinite(value))) {
    throw new Error('El rectángulo solo puede contener números');
  }
  if (south < -90 || north > 90) {
    throw new Error('La latitud (sur y norte) debe estar entre -90 y 90');
  }
  if (west < -180 || east > 180) {
    throw new Error('La longitud (oeste y este) debe estar entre -180 y 180');
  }
  if (south >= north) {
    throw new Error('El valor sur debe ser menor que el norte');
  }
  if (west >= east) {
    throw new Error('El valor oeste debe ser menor que el este');
  }

  return { south, west, north, east };
}

/** Human-readable description, used in the report. */
export function formatBoundingBox(bbox: BoundingBox): string {
  return `sur ${bbox.south}, oeste ${bbox.west}, norte ${bbox.north}, este ${bbox.east}`;
}

/** Stable text used in the name of the cache file. */
export function boundingBoxKey(bbox: BoundingBox): string {
  return `${bbox.south}_${bbox.west}_${bbox.north}_${bbox.east}`;
}

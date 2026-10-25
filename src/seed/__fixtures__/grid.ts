import { polylineLength, roundTo } from '../../osm/geo.js';
import type { LatLon } from '../../osm/types.js';
import type { SeedCatalogs, SeedSegment } from '../types.js';

const ORIGIN: LatLon = [1.2136, -77.2811];
/** About 100 m in degrees at this latitude. */
const SPACING = 0.0009;
const STREETS = 8;

/** Streets 1 and 6 are tertiary, 3 and 4 secondary, the others residential. */
function typeOf(index: number): string {
  if (index === 3 || index === 4) return 'secondary';
  if (index === 1 || index === 6) return 'tertiary';
  return 'residential';
}

/** Center of the grid: the "city center" used by the tests. */
export const GRID_CENTER: LatLon = [
  ORIGIN[0] + ((STREETS - 1) / 2) * SPACING,
  ORIGIN[1] + ((STREETS - 1) / 2) * SPACING,
];

/**
 * A small city: 8 "Calle" streets (east-west) crossed by 8 "Carrera" streets (north-south),
 * every street one road made of 7 segments of about 100 m. 112 segments in total.
 */
export function buildGrid(): SeedSegment[] {
  const segments: SeedSegment[] = [];
  let id = 1;

  for (let street = 0; street < STREETS; street++) {
    for (let block = 0; block < STREETS - 1; block++) {
      const lat = ORIGIN[0] + street * SPACING;
      const geometry: LatLon[] = [
        [lat, ORIGIN[1] + block * SPACING],
        [lat, ORIGIN[1] + (block + 1) * SPACING],
      ];
      segments.push({
        id: id++,
        roadId: 100 + street,
        roadName: `Calle ${10 + street}`,
        roadType: typeOf(street),
        lengthM: roundTo(polylineLength(geometry), 2),
        geometry,
      });
    }
  }

  for (let street = 0; street < STREETS; street++) {
    for (let block = 0; block < STREETS - 1; block++) {
      const lon = ORIGIN[1] + street * SPACING;
      const geometry: LatLon[] = [
        [ORIGIN[0] + block * SPACING, lon],
        [ORIGIN[0] + (block + 1) * SPACING, lon],
      ];
      segments.push({
        id: id++,
        roadId: 200 + street,
        roadName: `Carrera ${20 + street}`,
        roadType: typeOf(street),
        lengthM: roundTo(polylineLength(geometry), 2),
        geometry,
      });
    }
  }

  return segments;
}

export const testCatalogs: SeedCatalogs = {
  severities: [
    { id: 1, name: 'leve', costWeight: 0.5 },
    { id: 2, name: 'moderado', costWeight: 2 },
    { id: 3, name: 'grave', costWeight: 6 },
  ],
  statuses: [
    { id: 1, name: 'sin confirmar' },
    { id: 2, name: 'confirmado' },
    { id: 3, name: 'reparado' },
  ],
  repairFactor: 0.2,
};

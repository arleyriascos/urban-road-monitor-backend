import { readFileSync } from 'node:fs';
import type { OverpassResponse } from '../types.js';

/**
 * Small hand-made Overpass response used by the tests. It contains:
 *  - 5001 Calle 18: two-way street crossed by 5002 and 5003 (3 segments)
 *  - 5002 Carrera 25: one-way street (oneway=yes), crosses 5001
 *  - 5003 Carrera 24: reverse one-way street (oneway=-1), crosses 5001
 *  - 5004: roundabout that starts and ends at the same node (a loop)
 *  - 5005: street without a name
 *  - 5006 private service road (skipped), 5007 private road open to motor vehicles (kept)
 *  - 5008 footway (skipped by type), 5009 way without geometry (skipped as invalid)
 */
export function loadSampleResponse(): OverpassResponse {
  const file = new URL('./sample-overpass.json', import.meta.url);
  return JSON.parse(readFileSync(file, 'utf8')) as OverpassResponse;
}

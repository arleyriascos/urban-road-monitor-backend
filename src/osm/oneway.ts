import type { OnewayDirection } from './types.js';

/**
 * Reads the one-way rules of an OpenStreetMap way.
 *  - oneway=yes/true/1          -> "forward" (follows the order of the nodes)
 *  - oneway=-1/reverse          -> "reverse" (goes against the order of the nodes)
 *  - oneway=no/false/0          -> "none"
 *  - roundabouts without tag    -> "forward" (a roundabout is always one-way)
 *  - anything else (for example "reversible") is treated as two-way.
 */
export function interpretOneway(tags: Record<string, string>): OnewayDirection {
  const value = tags.oneway?.trim().toLowerCase();

  if (value === 'yes' || value === 'true' || value === '1') return 'forward';
  if (value === '-1' || value === 'reverse') return 'reverse';
  if (value === 'no' || value === 'false' || value === '0') return 'none';

  const isRoundabout = tags.junction === 'roundabout' || tags.junction === 'circular';
  if (value === undefined && isRoundabout) return 'forward';

  return 'none';
}

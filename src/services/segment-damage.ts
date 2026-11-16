import { roundTo } from '../osm/geo.js';

/** What a pothole contributes to the damage of the segment that contains it. */
export interface PotholeDamageInput {
  severityId: number;
  /** severity_levels.cost_weight: 0.5 (leve), 2 (moderado), 6 (grave). */
  severityWeight: number;
  /** 0 to 1: how sure we are that the pothole is real. */
  confidence: number;
  /**
   * Only a confirmed pothole (seen at least twice) changes the damage of the segment: one
   * sighting can be a shadow or a manhole cover, and must not send people round it. A repaired
   * pothole stops counting too.
   */
  affectsRoutes: boolean;
}

/** The status that makes a pothole count for the damage of its segment and for the routes. */
export const CONFIRMED_STATUS = 'confirmado';

export function statusAffectsRoutes(statusName: string): boolean {
  return statusName === CONFIRMED_STATUS;
}

export interface SegmentDamage {
  /** road_segments.damage_score: sum of severity weight x confidence. */
  damageScore: number;
  /** road_segments.max_severity_level_id: the worst severity among confirmed potholes. */
  maxSeverityLevelId: number | null;
}

const DAMAGE_DECIMALS = 4;

/**
 * Damage of a segment, from the specification:
 *   damage = sum over confirmed potholes of (severity weight x confidence)
 * A segment without confirmed potholes has damage 0 and no severity.
 */
export function computeSegmentDamage(potholes: readonly PotholeDamageInput[]): SegmentDamage {
  let damage = 0;
  let worstWeight = -1;
  let worstSeverityId: number | null = null;

  for (const pothole of potholes) {
    if (!pothole.affectsRoutes) continue;
    damage += pothole.severityWeight * pothole.confidence;
    if (pothole.severityWeight > worstWeight) {
      worstWeight = pothole.severityWeight;
      worstSeverityId = pothole.severityId;
    }
  }

  return { damageScore: roundTo(damage, DAMAGE_DECIMALS), maxSeverityLevelId: worstSeverityId };
}

/**
 * Cost of crossing a segment, used by the routing algorithms:
 *   cost = length x (1 + damage)
 * It is never below the real length, so the straight-line heuristic of A* stays valid.
 */
export function routeCost(lengthM: number, damageScore: number): number {
  return lengthM * (1 + damageScore);
}

import { roundTo } from '../osm/geo.js';

/** What a pothole contributes to the damage of the segment that contains it. */
export interface PotholeDamageInput {
  severityId: number;
  /** severity_levels.cost_weight: 0.5 (leve), 2 (moderado), 6 (grave). */
  severityWeight: number;
  /** 0 to 1: how sure we are that the pothole is real. */
  confidence: number;
  /** Repaired potholes stop affecting the segment. */
  isRepaired: boolean;
}

export interface SegmentDamage {
  /** road_segments.damage_score: sum of severity weight x confidence. */
  damageScore: number;
  /** road_segments.max_severity_level_id: the worst severity among active potholes. */
  maxSeverityLevelId: number | null;
}

const DAMAGE_DECIMALS = 4;

/**
 * Damage of a segment, from the specification:
 *   damage = sum over active potholes of (severity weight x confidence)
 * A segment without active potholes has damage 0 and no severity.
 */
export function computeSegmentDamage(potholes: readonly PotholeDamageInput[]): SegmentDamage {
  let damage = 0;
  let worstWeight = -1;
  let worstSeverityId: number | null = null;

  for (const pothole of potholes) {
    if (pothole.isRepaired) continue;
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

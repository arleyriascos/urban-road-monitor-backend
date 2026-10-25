import type { LatLon } from '../osm/types.js';
import type { SegmentDamage } from '../services/segment-damage.js';

/** A road segment read from the database, with what the seed needs to place potholes. */
export interface SeedSegment {
  id: number;
  roadId: number;
  roadName: string | null;
  /** OpenStreetMap highway value (primary, secondary, tertiary, residential...). */
  roadType: string;
  lengthM: number;
  geometry: LatLon[];
}

export interface SeedSeverity {
  id: number;
  name: string;
  costWeight: number;
}

export interface SeedStatus {
  id: number;
  name: string;
}

export interface SeedCatalogs {
  severities: SeedSeverity[];
  statuses: SeedStatus[];
  /** Confidence multiplier of a repaired pothole (system_parameters.repair_report_factor). */
  repairFactor: number;
}

export interface SeedOptions {
  /** How many potholes to create. */
  count: number;
  /** Same seed, same potholes. */
  seed: number;
  /** "Today": potholes are dated in the past relative to this moment. */
  now: Date;
  /** Center of the city; the corridors are the streets closest to it. */
  center: LatLon | null;
}

export interface PlannedPothole {
  segmentId: number;
  latitude: number;
  longitude: number;
  severityId: number;
  severityName: string;
  statusId: number;
  statusName: string;
  confidence: number;
  detectionCount: number;
  firstDetectedAt: Date;
  lastDetectedAt: Date;
  inCorridor: boolean;
}

export interface PlannedCorridor {
  roadId: number;
  name: string;
  potholes: number;
  /** Other streets running close by, available as an alternative route. */
  alternatives: number;
}

export interface SeedPlan {
  potholes: PlannedPothole[];
  corridors: PlannedCorridor[];
  /** New damage of every segment that has at least one pothole. */
  segmentDamage: Map<number, SegmentDamage>;
}

export interface SeedSummary {
  deletedPotholes: number;
  insertedPotholes: number;
  segmentsReset: number;
  segmentsWithDamage: number;
}

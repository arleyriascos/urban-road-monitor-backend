import { prisma } from '../config/database.js';
import { describeDatabaseTarget, type TargetDescription } from '../config/database-target.js';
import { env } from '../config/env.js';
import type { LatLon } from '../osm/types.js';
import type { SeedCatalogs, SeedPlan, SeedSegment, SeedSummary } from '../seed/types.js';
import type { PotholeSeedStore } from '../services/pothole-seed.service.js';

const CHUNK_SIZE = 2_000;
const DEFAULT_REPAIR_FACTOR = 0.2;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Reads what the seed needs and replaces ALL potholes with the planned ones.
 * Everything runs in one transaction: if something fails, nothing changes.
 */
export class PotholeSeedRepository implements PotholeSeedStore {
  constructor(private readonly databaseUrl: string = env.DATABASE_URL) {}

  describeTarget(): TargetDescription {
    return describeDatabaseTarget(this.databaseUrl);
  }

  async countDetections(): Promise<number> {
    const [row] = await prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM detections`;
    return row.total;
  }

  async loadInput(): Promise<{ segments: SeedSegment[]; catalogs: SeedCatalogs }> {
    const segmentRows = await prisma.$queryRaw<
      {
        id: bigint;
        road_id: bigint;
        road_name: string | null;
        road_type: string;
        length_m: number;
        geometry: LatLon[];
      }[]
    >`
      SELECT rs.id, rs.road_id, r.name AS road_name, rt.osm_highway_tag AS road_type,
             rs.length_m::float8 AS length_m, rs.geometry
      FROM road_segments rs
      JOIN roads r ON r.id = rs.road_id
      JOIN road_types rt ON rt.id = r.road_type_id
      ORDER BY rs.id`;

    const severities = await prisma.$queryRaw<{ id: number; name: string; cost_weight: number }[]>`
      SELECT id, name, cost_weight::float8 AS cost_weight FROM severity_levels ORDER BY id`;
    const statuses = await prisma.$queryRaw<{ id: number; name: string }[]>`
      SELECT id, name FROM pothole_statuses ORDER BY id`;
    const parameters = await prisma.$queryRaw<{ value: string }[]>`
      SELECT value FROM system_parameters WHERE key = 'repair_report_factor'`;

    const factor = Number(parameters[0]?.value);

    return {
      segments: segmentRows.map((row) => ({
        id: Number(row.id),
        roadId: Number(row.road_id),
        roadName: row.road_name,
        roadType: row.road_type,
        lengthM: row.length_m,
        geometry: row.geometry,
      })),
      catalogs: {
        severities: severities.map((row) => ({
          id: row.id,
          name: row.name,
          costWeight: row.cost_weight,
        })),
        statuses,
        repairFactor: Number.isFinite(factor) ? factor : DEFAULT_REPAIR_FACTOR,
      },
    };
  }

  async replaceAll(plan: SeedPlan): Promise<SeedSummary> {
    return prisma.$transaction(
      async (tx) => {
        // Status history and repair reports of the old potholes are deleted with them.
        const deletedPotholes = await tx.$executeRaw`DELETE FROM potholes`;
        const segmentsReset = await tx.$executeRaw`
          UPDATE road_segments SET damage_score = 0, max_severity_level_id = NULL
          WHERE damage_score <> 0 OR max_severity_level_id IS NOT NULL`;

        let insertedPotholes = 0;
        for (const part of chunk(plan.potholes, CHUNK_SIZE)) {
          const json = JSON.stringify(
            part.map((pothole) => ({
              road_segment_id: pothole.segmentId,
              severity_level_id: pothole.severityId,
              status_id: pothole.statusId,
              latitude: pothole.latitude,
              longitude: pothole.longitude,
              confidence: pothole.confidence,
              detection_count: pothole.detectionCount,
              first_detected_at: pothole.firstDetectedAt.toISOString(),
              last_detected_at: pothole.lastDetectedAt.toISOString(),
            })),
          );
          insertedPotholes += await tx.$executeRaw`
            INSERT INTO potholes
              (road_segment_id, severity_level_id, status_id, latitude, longitude,
               confidence, detection_count, first_detected_at, last_detected_at)
            SELECT r.road_segment_id, r.severity_level_id, r.status_id, r.latitude, r.longitude,
                   r.confidence, r.detection_count, r.first_detected_at, r.last_detected_at
            FROM jsonb_to_recordset(${json}::jsonb)
              AS r(road_segment_id bigint, severity_level_id int, status_id int,
                   latitude numeric, longitude numeric, confidence numeric,
                   detection_count int, first_detected_at timestamptz,
                   last_detected_at timestamptz)`;
        }

        const damage = [...plan.segmentDamage].map(([id, value]) => ({
          id,
          damage_score: value.damageScore,
          max_severity_level_id: value.maxSeverityLevelId,
        }));
        let segmentsWithDamage = 0;
        for (const part of chunk(damage, CHUNK_SIZE)) {
          const json = JSON.stringify(part);
          segmentsWithDamage += await tx.$executeRaw`
            UPDATE road_segments rs
            SET damage_score = u.damage_score, max_severity_level_id = u.max_severity_level_id
            FROM jsonb_to_recordset(${json}::jsonb)
              AS u(id bigint, damage_score numeric, max_severity_level_id int)
            WHERE rs.id = u.id`;
        }

        return { deletedPotholes, insertedPotholes, segmentsReset, segmentsWithDamage };
      },
      { timeout: 5 * 60 * 1000, maxWait: 60_000 },
    );
  }
}

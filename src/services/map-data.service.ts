import { featureCollection, lineStringFeature, pointFeature } from '../geojson/mappers.js';
import type { FeatureCollection, LineStringGeometry, PointGeometry } from '../geojson/types.js';
import { roundTo } from '../osm/geo.js';
import { potholeRepository, type PotholeRepository } from '../repositories/pothole.repository.js';
import {
  roadSegmentRepository,
  type RoadSegmentRepository,
} from '../repositories/road-segment.repository.js';

/** Severity shown for a segment that has no active potholes. Matches the v_segment_status view. */
export const NO_POTHOLES_SEVERITY = 'sin baches';
export const NO_POTHOLES_COLOR = '#22C55E';

const POTHOLE_STATUS_ORDER = ['sin confirmar', 'confirmado', 'reparado'] as const;

export interface SegmentProperties {
  roadId: number;
  name: string | null;
  roadType: string;
  lengthM: number;
  isOneway: boolean;
  damageScore: number;
  severity: string;
  color: string;
  activePotholes: number;
}

export interface PotholeProperties {
  severity: string;
  color: string;
  status: string;
  confidence: number;
  detectionCount: number;
  segmentId: number | null;
  roadName: string | null;
  firstDetectedAt: string;
  lastDetectedAt: string;
}

export type SegmentCollection = FeatureCollection<LineStringGeometry, SegmentProperties>;
export type PotholeCollection = FeatureCollection<PointGeometry, PotholeProperties>;

export interface NetworkStats {
  roads: number;
  segments: number;
  totalLengthKm: number;
  /** Legend of the map: how many segments have each severity as their worst pothole. */
  segmentsBySeverity: { severity: string; color: string; count: number }[];
  potholesByStatus: { status: string; count: number }[];
  lastPotholeDetectedAt: string | null;
}

/** Builds what the map needs: the colored streets, the potholes and the legend numbers. */
export class MapDataService {
  constructor(
    private readonly segments: RoadSegmentRepository = roadSegmentRepository,
    private readonly potholes: PotholeRepository = potholeRepository,
  ) {}

  async getRoadSegments(): Promise<SegmentCollection> {
    const rows = await this.segments.findAllStatuses();

    return featureCollection(
      rows.map((row) =>
        lineStringFeature<SegmentProperties>(row.id, row.geometry, {
          roadId: row.roadId,
          name: row.roadName,
          roadType: row.roadType,
          lengthM: row.lengthM,
          isOneway: row.isOneway,
          damageScore: row.damageScore,
          severity: row.severity,
          color: row.color,
          activePotholes: row.activePotholes,
        }),
      ),
    );
  }

  async getPotholes(options: { includeRepaired: boolean }): Promise<PotholeCollection> {
    const rows = await this.potholes.findAll(options.includeRepaired);

    return featureCollection(
      rows.map((row) =>
        pointFeature<PotholeProperties>(row.id, row.latitude, row.longitude, {
          severity: row.severity,
          color: row.color,
          status: row.status,
          confidence: row.confidence,
          detectionCount: row.detectionCount,
          segmentId: row.segmentId,
          roadName: row.roadName,
          firstDetectedAt: row.firstDetectedAt.toISOString(),
          lastDetectedAt: row.lastDetectedAt.toISOString(),
        }),
      ),
    );
  }

  async getNetworkStats(): Promise<NetworkStats> {
    const [totals, bySeverity, levels, byStatus, lastDetection] = await Promise.all([
      this.segments.getTotals(),
      this.segments.countBySeverity(),
      this.segments.findSeverityLevels(),
      this.potholes.countByStatus(),
      this.potholes.findLastDetectionAt(),
    ]);

    const severityCounts = new Map(bySeverity.map((row) => [row.severity, row.count]));
    const statusCounts = new Map(byStatus.map((row) => [row.status, row.count]));

    return {
      roads: totals.roads,
      segments: totals.segments,
      totalLengthKm: roundTo(totals.totalLengthM / 1000, 2),
      segmentsBySeverity: [
        {
          severity: NO_POTHOLES_SEVERITY,
          color: NO_POTHOLES_COLOR,
          count: severityCounts.get(NO_POTHOLES_SEVERITY) ?? 0,
        },
        ...levels.map((level) => ({
          severity: level.name,
          color: level.color,
          count: severityCounts.get(level.name) ?? 0,
        })),
      ],
      potholesByStatus: POTHOLE_STATUS_ORDER.map((status) => ({
        status,
        count: statusCounts.get(status) ?? 0,
      })),
      lastPotholeDetectedAt: lastDetection ? lastDetection.toISOString() : null,
    };
  }
}

export const mapDataService = new MapDataService();

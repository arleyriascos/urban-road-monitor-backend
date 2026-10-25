import { describe, expect, it, vi } from 'vitest';
import type { PotholeRepository, PotholeRow } from '../repositories/pothole.repository.js';
import type {
  RoadSegmentRepository,
  SegmentStatusRow,
} from '../repositories/road-segment.repository.js';
import { MapDataService } from './map-data.service.js';

const segmentRow: SegmentStatusRow = {
  id: 10,
  roadId: 3,
  roadName: 'Calle 18',
  roadType: 'Calle residencial',
  lengthM: 111.17,
  isOneway: true,
  damageScore: 4.5,
  severity: 'grave',
  color: '#DC2626',
  activePotholes: 2,
  geometry: [
    [1.214, -77.282],
    [1.214, -77.281],
  ],
};

const potholeRow: PotholeRow = {
  id: '0b9a3f2e-0000-4000-8000-000000000001',
  latitude: 1.2141,
  longitude: -77.2815,
  severity: 'grave',
  color: '#DC2626',
  status: 'confirmado',
  confidence: 0.875,
  detectionCount: 3,
  segmentId: 10,
  roadName: 'Calle 18',
  firstDetectedAt: new Date('2026-10-01T10:00:00.000Z'),
  lastDetectedAt: new Date('2026-10-20T15:30:00.000Z'),
};

function createService(
  overrides: {
    segments?: Partial<RoadSegmentRepository>;
    potholes?: Partial<PotholeRepository>;
  } = {},
) {
  const segments: RoadSegmentRepository = {
    findAllStatuses: vi.fn(async () => [segmentRow]),
    getTotals: vi.fn(async () => ({ roads: 2, segments: 5, totalLengthM: 1234.567 })),
    countBySeverity: vi.fn(async () => [
      { severity: 'sin baches', count: 3 },
      { severity: 'grave', count: 2 },
    ]),
    findSeverityLevels: vi.fn(async () => [
      { name: 'leve', color: '#FACC15', costWeight: 0.5 },
      { name: 'moderado', color: '#F97316', costWeight: 2 },
      { name: 'grave', color: '#DC2626', costWeight: 6 },
    ]),
    ...overrides.segments,
  };
  const potholes: PotholeRepository = {
    findAll: vi.fn(async () => [potholeRow]),
    countByStatus: vi.fn(async () => [
      { status: 'reparado', count: 1 },
      { status: 'confirmado', count: 4 },
    ]),
    findLastDetectionAt: vi.fn(async () => new Date('2026-10-20T15:30:00.000Z')),
    ...overrides.potholes,
  };
  return { service: new MapDataService(segments, potholes), segments, potholes };
}

describe('MapDataService.getRoadSegments', () => {
  it('returns a FeatureCollection of LineStrings in [longitude, latitude] order', async () => {
    const { service } = createService();
    const collection = await service.getRoadSegments();

    expect(collection.type).toBe('FeatureCollection');
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]).toEqual({
      type: 'Feature',
      id: 10,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-77.282, 1.214],
          [-77.281, 1.214],
        ],
      },
      properties: {
        roadId: 3,
        name: 'Calle 18',
        roadType: 'Calle residencial',
        lengthM: 111.17,
        isOneway: true,
        damageScore: 4.5,
        severity: 'grave',
        color: '#DC2626',
        activePotholes: 2,
      },
    });
  });

  it('returns an empty collection when there are no segments', async () => {
    const { service } = createService({ segments: { findAllStatuses: async () => [] } });
    expect((await service.getRoadSegments()).features).toEqual([]);
  });
});

describe('MapDataService.getPotholes', () => {
  it('returns Points and formats the dates as ISO strings', async () => {
    const { service } = createService();
    const [feature] = (await service.getPotholes({ includeRepaired: false })).features;

    expect(feature.id).toBe(potholeRow.id);
    expect(feature.geometry).toEqual({ type: 'Point', coordinates: [-77.2815, 1.2141] });
    expect(feature.properties).toMatchObject({
      severity: 'grave',
      status: 'confirmado',
      confidence: 0.875,
      detectionCount: 3,
      segmentId: 10,
      roadName: 'Calle 18',
      firstDetectedAt: '2026-10-01T10:00:00.000Z',
      lastDetectedAt: '2026-10-20T15:30:00.000Z',
    });
  });

  it('passes includeRepaired to the repository', async () => {
    const { service, potholes } = createService();
    await service.getPotholes({ includeRepaired: true });
    expect(potholes.findAll).toHaveBeenCalledWith(true);
  });
});

describe('MapDataService.getNetworkStats', () => {
  it('builds the legend from "sin baches" up to the worst severity, filling missing counts with 0', async () => {
    const { service } = createService();
    const stats = await service.getNetworkStats();

    expect(stats.segmentsBySeverity).toEqual([
      { severity: 'sin baches', color: '#22C55E', count: 3 },
      { severity: 'leve', color: '#FACC15', count: 0 },
      { severity: 'moderado', color: '#F97316', count: 0 },
      { severity: 'grave', color: '#DC2626', count: 2 },
    ]);
  });

  it('lists the three pothole statuses in a fixed order, with 0 for the missing ones', async () => {
    const { service } = createService();
    const stats = await service.getNetworkStats();

    expect(stats.potholesByStatus).toEqual([
      { status: 'sin confirmar', count: 0 },
      { status: 'confirmado', count: 4 },
      { status: 'reparado', count: 1 },
    ]);
  });

  it('reports totals, length in kilometers and the last detection', async () => {
    const { service } = createService();
    const stats = await service.getNetworkStats();

    expect(stats).toMatchObject({
      roads: 2,
      segments: 5,
      totalLengthKm: 1.23,
      lastPotholeDetectedAt: '2026-10-20T15:30:00.000Z',
    });
  });

  it('uses null as last detection when there are no potholes', async () => {
    const { service } = createService({ potholes: { findLastDetectionAt: async () => null } });
    expect((await service.getNetworkStats()).lastPotholeDetectedAt).toBeNull();
  });
});

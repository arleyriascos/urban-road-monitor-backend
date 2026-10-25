import { ROAD_TYPE_TAGS, type RoadTypeTag } from './config.js';
import { polylineLength, roundTo } from './geo.js';
import type {
  BuildStats,
  LatLon,
  NetworkDraft,
  NodeDraft,
  OnewayDirection,
  ParsedWay,
  RoadDraft,
  SegmentDraft,
} from './types.js';

export interface BuildResult {
  network: NetworkDraft;
  stats: BuildStats;
}

/** How many times each OpenStreetMap node appears in the imported ways. */
function countNodeUsage(ways: readonly ParsedWay[]): Map<number, number> {
  const usage = new Map<number, number>();
  for (const way of ways) {
    for (const nodeId of way.nodeIds) {
      usage.set(nodeId, (usage.get(nodeId) ?? 0) + 1);
    }
  }
  return usage;
}

/**
 * Positions where a way is cut into segments: its two ends and every node shared
 * with another way (an intersection). A segment that would start and end at the
 * same node (a loop) is split in the middle so it still has two different nodes.
 */
function findCutIndexes(nodeIds: readonly number[], usage: ReadonlyMap<number, number>): number[] {
  const last = nodeIds.length - 1;
  const cuts: number[] = [];

  for (let i = 0; i <= last; i++) {
    if (i === 0 || i === last || (usage.get(nodeIds[i]) ?? 0) > 1) {
      cuts.push(i);
    }
  }

  const result: number[] = [cuts[0]];
  for (let k = 1; k < cuts.length; k++) {
    const start = cuts[k - 1];
    const end = cuts[k];
    if (nodeIds[start] === nodeIds[end] && end - start >= 2) {
      result.push(start + Math.floor((end - start) / 2));
    }
    result.push(end);
  }
  return result;
}

function createSegment(
  index: number,
  oneway: OnewayDirection,
  fromId: number,
  toId: number,
  points: LatLon[],
  lengthM: number,
): SegmentDraft {
  // Reverse one-way streets are stored flipped, so traffic always goes from -> to.
  const flipped = oneway === 'reverse';
  const ordered = flipped ? [...points].reverse() : points;

  return {
    index,
    fromOsmNodeId: flipped ? toId : fromId,
    toOsmNodeId: flipped ? fromId : toId,
    lengthM,
    isOneway: oneway !== 'none',
    geometry: ordered.map(([lat, lon]): LatLon => [roundTo(lat, 6), roundTo(lon, 6)]),
  };
}

function registerNode(nodes: Map<number, NodeDraft>, osmNodeId: number, point: LatLon): void {
  if (!nodes.has(osmNodeId)) {
    nodes.set(osmNodeId, {
      osmNodeId,
      latitude: roundTo(point[0], 6),
      longitude: roundTo(point[1], 6),
    });
  }
}

/**
 * Builds the road graph: one road per way, one node per intersection or end,
 * and one segment between each pair of consecutive nodes of a road.
 */
export function buildNetwork(ways: readonly ParsedWay[]): BuildResult {
  const usage = countNodeUsage(ways);
  const nodes = new Map<number, NodeDraft>();
  const roads: RoadDraft[] = [];
  const roadsByType = Object.fromEntries(ROAD_TYPE_TAGS.map((tag) => [tag, 0])) as Record<
    RoadTypeTag,
    number
  >;
  let segmentCount = 0;
  let onewaySegments = 0;
  let skippedSegments = 0;
  let droppedRoads = 0;
  let totalLengthM = 0;

  for (const way of ways) {
    const cuts = findCutIndexes(way.nodeIds, usage);
    const segments: SegmentDraft[] = [];

    for (let k = 1; k < cuts.length; k++) {
      const start = cuts[k - 1];
      const end = cuts[k];
      const points = way.points.slice(start, end + 1);
      const fromId = way.nodeIds[start];
      const toId = way.nodeIds[end];
      const lengthM = roundTo(polylineLength(points), 2);

      if (fromId === toId || lengthM <= 0) {
        skippedSegments++;
        continue;
      }

      registerNode(nodes, fromId, points[0]);
      registerNode(nodes, toId, points[points.length - 1]);
      segments.push(createSegment(segments.length, way.oneway, fromId, toId, points, lengthM));
    }

    if (segments.length === 0) {
      droppedRoads++;
      continue;
    }

    const roadLengthM = roundTo(
      segments.reduce((sum, segment) => sum + segment.lengthM, 0),
      2,
    );
    roads.push({
      osmWayId: way.osmWayId,
      name: way.name,
      highway: way.highway,
      totalLengthM: roadLengthM,
      segments,
    });
    roadsByType[way.highway]++;
    segmentCount += segments.length;
    onewaySegments += segments.filter((segment) => segment.isOneway).length;
    totalLengthM += roadLengthM;
  }

  return {
    network: { roads, nodes: [...nodes.values()] },
    stats: {
      roads: roads.length,
      nodes: nodes.size,
      segments: segmentCount,
      onewaySegments,
      totalLengthKm: roundTo(totalLengthM / 1000, 2),
      skippedSegments,
      droppedRoads,
      roadsByType,
    },
  };
}

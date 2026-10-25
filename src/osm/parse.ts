import { BLOCKED_ACCESS_VALUES, ROAD_TYPE_TAGS, type RoadTypeTag } from './config.js';
import { interpretOneway } from './oneway.js';
import type { LatLon, OverpassElement, OverpassResponse, ParsedWay, ParseStats } from './types.js';

const MAX_NAME_LENGTH = 200;

export interface ParseResult {
  ways: ParsedWay[];
  stats: ParseStats;
}

function isRoadTypeTag(value: string | undefined): value is RoadTypeTag {
  return value !== undefined && (ROAD_TYPE_TAGS as readonly string[]).includes(value);
}

/**
 * The most specific access tag wins: motor_vehicle, then vehicle, then access.
 * Only "no" and "private" close the way to cars and motorcycles.
 */
function allowsMotorVehicles(tags: Record<string, string>): boolean {
  const value = (tags.motor_vehicle ?? tags.vehicle ?? tags.access)?.trim().toLowerCase();
  return value === undefined || !BLOCKED_ACCESS_VALUES.includes(value);
}

function extractName(tags: Record<string, string>): string | null {
  const name = (tags.name ?? tags.ref ?? '').trim();
  return name === '' ? null : name.slice(0, MAX_NAME_LENGTH);
}

/** Node ids and coordinates must exist, have the same size and be valid. */
function extractGeometry(element: OverpassElement): { nodeIds: number[]; points: LatLon[] } | null {
  const { nodes, geometry } = element;

  if (!Array.isArray(nodes) || !Array.isArray(geometry)) return null;
  if (nodes.length < 2 || nodes.length !== geometry.length) return null;

  const points: LatLon[] = [];
  for (const point of geometry) {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
    points.push([point.lat, point.lon]);
  }

  return { nodeIds: nodes, points };
}

/** Turns the Overpass response into the roads that will be imported. */
export function parseOverpassResponse(response: OverpassResponse): ParseResult {
  const stats: ParseStats = {
    elementsRead: 0,
    waysRead: 0,
    waysKept: 0,
    skippedType: 0,
    skippedAccess: 0,
    skippedInvalid: 0,
  };
  const ways: ParsedWay[] = [];

  for (const element of response.elements ?? []) {
    stats.elementsRead++;
    if (element.type !== 'way') continue;
    stats.waysRead++;

    const tags = element.tags ?? {};
    const highway = tags.highway;

    if (!isRoadTypeTag(highway)) {
      stats.skippedType++;
      continue;
    }
    if (!allowsMotorVehicles(tags)) {
      stats.skippedAccess++;
      continue;
    }

    const geometry = extractGeometry(element);
    if (!geometry) {
      stats.skippedInvalid++;
      continue;
    }

    ways.push({
      osmWayId: element.id,
      name: extractName(tags),
      highway,
      oneway: interpretOneway(tags),
      nodeIds: geometry.nodeIds,
      points: geometry.points,
    });
    stats.waysKept++;
  }

  return { ways, stats };
}

import type { RoadTypeTag } from './config.js';

/** A point as [latitude, longitude]. */
export type LatLon = [latitude: number, longitude: number];

/**
 * Direction of travel allowed on a way, relative to the order of its nodes:
 * "forward" follows the node order, "reverse" goes against it.
 */
export type OnewayDirection = 'none' | 'forward' | 'reverse';

/** Subset of an element of the Overpass JSON response (queried with "out geom"). */
export interface OverpassElement {
  type: string;
  id: number;
  nodes?: number[];
  geometry?: ({ lat: number; lon: number } | null)[];
  tags?: Record<string, string>;
}

export interface OverpassResponse {
  elements?: OverpassElement[];
  remark?: string;
}

/** A road kept from OpenStreetMap, with its nodes and coordinates in the same order. */
export interface ParsedWay {
  osmWayId: number;
  name: string | null;
  highway: RoadTypeTag;
  oneway: OnewayDirection;
  nodeIds: number[];
  points: LatLon[];
}

export interface ParseStats {
  elementsRead: number;
  waysRead: number;
  waysKept: number;
  skippedType: number;
  skippedAccess: number;
  skippedInvalid: number;
}

/**
 * A graph edge between two intersections. When isOneway is true, traffic goes
 * from fromOsmNodeId to toOsmNodeId and geometry follows that direction.
 */
export interface SegmentDraft {
  index: number;
  fromOsmNodeId: number;
  toOsmNodeId: number;
  lengthM: number;
  isOneway: boolean;
  geometry: LatLon[];
}

export interface RoadDraft {
  osmWayId: number;
  name: string | null;
  highway: RoadTypeTag;
  totalLengthM: number;
  segments: SegmentDraft[];
}

/** A graph node: an intersection or the end of a road. */
export interface NodeDraft {
  osmNodeId: number;
  latitude: number;
  longitude: number;
}

export interface NetworkDraft {
  roads: RoadDraft[];
  nodes: NodeDraft[];
}

export interface BuildStats {
  roads: number;
  nodes: number;
  segments: number;
  onewaySegments: number;
  totalLengthKm: number;
  skippedSegments: number;
  droppedRoads: number;
  roadsByType: Record<RoadTypeTag, number>;
}

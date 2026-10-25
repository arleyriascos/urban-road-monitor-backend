import { describe, expect, it } from 'vitest';
import { loadSampleResponse } from './__fixtures__/sample.js';
import { parseOverpassResponse } from './parse.js';
import { buildNetwork } from './segmentize.js';
import type { ParsedWay, RoadDraft } from './types.js';

const sample = buildNetwork(parseOverpassResponse(loadSampleResponse()).ways);

function road(osmWayId: number): RoadDraft {
  const found = sample.network.roads.find((item) => item.osmWayId === osmWayId);
  if (!found) throw new Error(`Road ${osmWayId} not found`);
  return found;
}

function simpleWay(osmWayId: number, nodeIds: number[], latitude: number): ParsedWay {
  return {
    osmWayId,
    name: null,
    highway: 'residential',
    oneway: 'none',
    nodeIds,
    points: nodeIds.map((_id, i): [number, number] => [latitude, -77 + i * 0.001]),
  };
}

describe('buildNetwork with the sample data', () => {
  it('builds roads, nodes and segments', () => {
    expect(sample.stats).toMatchObject({
      roads: 6,
      nodes: 12,
      segments: 11,
      onewaySegments: 6,
      skippedSegments: 0,
      droppedRoads: 0,
    });
    expect(sample.stats.roadsByType).toEqual({
      trunk: 0,
      primary: 0,
      secondary: 1,
      tertiary: 1,
      residential: 3,
      living_street: 0,
      service: 1,
      unclassified: 0,
    });
  });

  it('cuts a street at every intersection', () => {
    const calle18 = road(5001);
    expect(calle18.segments).toHaveLength(3);
    expect(calle18.segments.map((segment) => segment.index)).toEqual([0, 1, 2]);
    expect(calle18.segments.map((segment) => [segment.fromOsmNodeId, segment.toOsmNodeId])).toEqual(
      [
        [1001, 1002],
        [1002, 1003],
        [1003, 1004],
      ],
    );
  });

  it('measures each segment from its geometry', () => {
    const [first] = road(5001).segments;
    expect(first.lengthM).toBeGreaterThan(111);
    expect(first.lengthM).toBeLessThan(111.4);
    expect(road(5001).totalLengthM).toBeCloseTo(first.lengthM * 3, 1);
  });

  it('keeps the intermediate points of a curved segment in its geometry', () => {
    const [first, second] = road(5002).segments;
    expect(first.geometry).toHaveLength(3);
    expect(first.fromOsmNodeId).toBe(2001);
    expect(first.toOsmNodeId).toBe(1002);
    expect(second.geometry).toHaveLength(2);
  });

  it('marks one-way streets', () => {
    expect(road(5002).segments.every((segment) => segment.isOneway)).toBe(true);
    expect(road(5001).segments.some((segment) => segment.isOneway)).toBe(false);
  });

  it('flips reverse one-way streets so traffic always goes from -> to', () => {
    const [first, second] = road(5003).segments;
    expect([first.fromOsmNodeId, first.toOsmNodeId]).toEqual([1003, 3001]);
    expect(first.geometry[0]).toEqual([1.214, -77.28]);
    expect(first.geometry[first.geometry.length - 1]).toEqual([1.215, -77.28]);
    expect([second.fromOsmNodeId, second.toOsmNodeId]).toEqual([3002, 1003]);
  });

  it('splits a roundabout that starts and ends at the same node', () => {
    const roundabout = road(5004);
    expect(roundabout.segments).toHaveLength(2);
    expect(
      roundabout.segments.map((segment) => [segment.fromOsmNodeId, segment.toOsmNodeId]),
    ).toEqual([
      [1004, 4002],
      [4002, 1004],
    ]);
    expect(roundabout.segments.every((segment) => segment.isOneway)).toBe(true);
  });

  it('keeps streets without a name', () => {
    expect(road(5005).name).toBeNull();
  });

  it('registers each node once, with rounded coordinates', () => {
    const ids = sample.network.nodes.map((node) => node.osmNodeId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(sample.network.nodes.find((node) => node.osmNodeId === 1002)).toEqual({
      osmNodeId: 1002,
      latitude: 1.214,
      longitude: -77.281,
    });
  });

  it('does not create nodes for points that are not intersections or ends', () => {
    const ids = sample.network.nodes.map((node) => node.osmNodeId);
    expect(ids).not.toContain(2002);
    expect(ids).not.toContain(4001);
  });

  it('adds the total length in kilometers', () => {
    expect(sample.stats.totalLengthKm).toBeGreaterThan(0.7);
    expect(sample.stats.totalLengthKm).toBeLessThan(1.2);
  });
});

describe('buildNetwork edge cases', () => {
  it('cuts two ways that share a node in the middle of both', () => {
    const { network, stats } = buildNetwork([
      simpleWay(1, [1, 2, 3], 1.2),
      simpleWay(2, [4, 2, 5], 1.3),
    ]);
    expect(stats.segments).toBe(4);
    expect(network.nodes.map((node) => node.osmNodeId).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps one segment when no node of the way is shared', () => {
    const { network } = buildNetwork([simpleWay(1, [1, 2, 3], 1.2), simpleWay(2, [4, 5], 1.3)]);
    const first = network.roads[0];
    expect(first.segments).toHaveLength(1);
    expect(first.segments[0].geometry).toHaveLength(3);
  });

  it('drops a way whose points are all the same place (zero length)', () => {
    const way: ParsedWay = {
      ...simpleWay(1, [1, 2], 1.2),
      points: [
        [1.2, -77.2],
        [1.2, -77.2],
      ],
    };
    const { network, stats } = buildNetwork([way]);
    expect(network.roads).toHaveLength(0);
    expect(stats.skippedSegments).toBe(1);
    expect(stats.droppedRoads).toBe(1);
  });

  it('skips a segment that starts and ends at the same node and cannot be split', () => {
    const { network, stats } = buildNetwork([simpleWay(1, [7, 7], 1.2)]);
    expect(network.roads).toHaveLength(0);
    expect(stats.skippedSegments).toBe(1);
  });

  it('splits a small closed loop into two segments', () => {
    const { network } = buildNetwork([simpleWay(1, [1, 2, 1], 1.2)]);
    expect(network.roads[0].segments).toHaveLength(2);
  });

  it('returns an empty network without ways', () => {
    const { network, stats } = buildNetwork([]);
    expect(network).toEqual({ roads: [], nodes: [] });
    expect(stats.segments).toBe(0);
  });
});

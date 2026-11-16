import { Trie } from '../structures/trie.js';
import { normalizeName } from './name-normalizer.js';

/** A street as the database knows it: one way, with the box that contains it. */
export interface RoadPlace {
  roadId: number;
  name: string | null;
  segments: number;
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

export interface Bounds {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

/** What a search answers: every way that has the name, as the one street the person means. */
export interface StreetMatch {
  name: string;
  roadIds: number[];
  segments: number;
  /** The middle of the box, to center the map on. */
  center: { latitude: number; longitude: number };
  bounds: Bounds;
}

interface Group {
  name: string;
  roadIds: number[];
  segments: number;
  bounds: Bounds;
}

/**
 * Finds streets by the beginning of their name while the person types. Ways that share a name
 * (OpenStreetMap splits a long street into many) are one street here. Two tries are used: one over
 * the whole name and one over each name from its second word on, so "18" finds "Calle 18" too,
 * but after the streets whose names start with "18".
 */
export class RoadSearchIndex {
  private byName = new Trie<number>();
  private byWord = new Trie<number>();
  private groups: Group[] = [];

  get size(): number {
    return this.groups.length;
  }

  /** Replaces what the index knows. Roads without a name cannot be searched and are left out. */
  build(roads: readonly RoadPlace[]): void {
    const grouped = new Map<string, Group>();
    for (const road of roads) {
      const key = road.name === null ? '' : normalizeName(road.name);
      if (key === '') continue;
      const box: Bounds = {
        minLatitude: road.minLatitude,
        maxLatitude: road.maxLatitude,
        minLongitude: road.minLongitude,
        maxLongitude: road.maxLongitude,
      };
      const group = grouped.get(key);
      if (!group) {
        grouped.set(key, {
          name: road.name!.trim().replace(/\s+/g, ' '),
          roadIds: [road.roadId],
          segments: road.segments,
          bounds: box,
        });
        continue;
      }
      group.roadIds.push(road.roadId);
      group.segments += road.segments;
      group.bounds = {
        minLatitude: Math.min(group.bounds.minLatitude, box.minLatitude),
        maxLatitude: Math.max(group.bounds.maxLatitude, box.maxLatitude),
        minLongitude: Math.min(group.bounds.minLongitude, box.minLongitude),
        maxLongitude: Math.max(group.bounds.maxLongitude, box.maxLongitude),
      };
    }

    const byName = new Trie<number>();
    const byWord = new Trie<number>();
    // Sorted by normalized name so the position of a street, and so every answer, does not
    // depend on the order the database returned the roads in.
    const keys = [...grouped.keys()].sort();
    const groups = keys.map((key, position) => {
      const group = grouped.get(key)!;
      group.roadIds.sort((a, b) => a - b);
      byName.insert(key, position);
      const words = key.split(' ');
      for (let i = 1; i < words.length; i += 1) byWord.insert(words.slice(i).join(' '), position);
      return group;
    });

    // Swapped in at the end, so a search that runs while this one builds sees a whole index.
    this.byName = byName;
    this.byWord = byWord;
    this.groups = groups;
  }

  /** The streets whose name starts with `query`, then those with a word that does. */
  search(query: string, limit = 8): StreetMatch[] {
    const wanted = normalizeName(query);
    if (wanted === '' || limit <= 0) return [];

    const seen = new Set<number>();
    const found: StreetMatch[] = [];
    for (const trie of [this.byName, this.byWord]) {
      for (const position of trie.withPrefix(wanted)) {
        if (found.length >= limit) return found;
        if (seen.has(position)) continue;
        seen.add(position);
        found.push(this.describe(this.groups[position]!));
      }
    }
    return found;
  }

  private describe(group: Group): StreetMatch {
    const { bounds } = group;
    return {
      name: group.name,
      roadIds: [...group.roadIds],
      segments: group.segments,
      center: {
        latitude: (bounds.minLatitude + bounds.maxLatitude) / 2,
        longitude: (bounds.minLongitude + bounds.maxLongitude) / 2,
      },
      bounds: { ...bounds },
    };
  }
}

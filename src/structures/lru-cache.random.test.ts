/**
 * Random operations on the LRU cache, compared with a slow but obvious reference: an
 * array of [key, value] pairs ordered from the most to the least recently used. The
 * seeds are fixed, so every run performs the same operations.
 */
import { describe, expect, it } from 'vitest';
import { LruCache } from './lru-cache.js';

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

class ReferenceLru {
  readonly pairs: [string, number][] = []; // most recently used first
  hits = 0;
  misses = 0;
  evictions = 0;

  constructor(private readonly capacity: number) {}

  get(key: string): number | undefined {
    const index = this.pairs.findIndex((pair) => pair[0] === key);
    if (index === -1) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    const [pair] = this.pairs.splice(index, 1);
    this.pairs.unshift(pair);
    return pair[1];
  }

  peek(key: string): number | undefined {
    return this.pairs.find((pair) => pair[0] === key)?.[1];
  }

  set(key: string, value: number): void {
    const index = this.pairs.findIndex((pair) => pair[0] === key);
    if (index !== -1) this.pairs.splice(index, 1);
    this.pairs.unshift([key, value]);
    if (this.pairs.length > this.capacity) {
      this.pairs.pop();
      this.evictions++;
    }
  }

  delete(key: string): boolean {
    const index = this.pairs.findIndex((pair) => pair[0] === key);
    if (index === -1) return false;
    this.pairs.splice(index, 1);
    return true;
  }
}

describe('LruCache against a reference', () => {
  it.each([
    [1, 1],
    [2, 7],
    [3, 50],
    [4, 200],
  ])('matches the reference after every operation (seed %i, capacity %i)', (seed, capacity) => {
    const random = seededRandom(seed);
    const cache = new LruCache<number>(capacity);
    const reference = new ReferenceLru(capacity);
    const distinctKeys = capacity * 3; // more keys than room, so evictions happen

    for (let step = 0; step < 3_000; step++) {
      const key = `ruta-${Math.floor(random() * distinctKeys)}`;
      const action = random();
      if (action < 0.45) {
        const value = Math.floor(random() * 1_000);
        cache.set(key, value);
        reference.set(key, value);
      } else if (action < 0.85) {
        expect(cache.get(key)).toBe(reference.get(key));
      } else if (action < 0.95) {
        expect(cache.peek(key)).toBe(reference.peek(key));
      } else {
        expect(cache.delete(key)).toBe(reference.delete(key));
      }

      expect(cache.keys()).toEqual(reference.pairs.map((pair) => pair[0]));
      expect(cache.isValid()).toBe(true);
    }

    expect(cache.stats()).toEqual({
      hits: reference.hits,
      misses: reference.misses,
      evictions: reference.evictions,
      size: reference.pairs.length,
      capacity,
    });
    expect(reference.evictions).toBeGreaterThan(0);
  });
});

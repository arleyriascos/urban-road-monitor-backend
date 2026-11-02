/**
 * Random operations on the hash table, compared with a slow but obvious reference: an
 * array of [key, value] pairs searched from end to end. The seeds are fixed, so every
 * run performs the same operations.
 */
import { describe, expect, it } from 'vitest';
import { HashTable } from './hash-table.js';

/** Small seeded random generator (mulberry32), so the operations repeat on every run. */
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

class ReferenceTable {
  readonly pairs: [string, number][] = [];

  get(key: string): number | undefined {
    return this.pairs.find((pair) => pair[0] === key)?.[1];
  }

  set(key: string, value: number): void {
    const pair = this.pairs.find((candidate) => candidate[0] === key);
    if (pair) pair[1] = value;
    else this.pairs.push([key, value]);
  }

  delete(key: string): boolean {
    const index = this.pairs.findIndex((pair) => pair[0] === key);
    if (index === -1) return false;
    this.pairs.splice(index, 1);
    return true;
  }
}

describe('HashTable against a reference', () => {
  it.each([1, 2, 3, 4, 5])('matches the reference after every operation (seed %i)', (seed) => {
    const random = seededRandom(seed);
    const table = new HashTable<number>(1);
    const reference = new ReferenceTable();

    for (let step = 0; step < 3_000; step++) {
      // Few distinct keys, so updates, deletes and collisions happen often.
      const key = `k${Math.floor(random() * 300)}`;
      const action = random();
      if (action < 0.5) {
        const value = Math.floor(random() * 1_000);
        table.set(key, value);
        reference.set(key, value);
      } else if (action < 0.75) {
        expect(table.delete(key)).toBe(reference.delete(key));
      } else {
        expect(table.get(key)).toBe(reference.get(key));
        expect(table.has(key)).toBe(reference.get(key) !== undefined);
      }

      expect(table.size).toBe(reference.pairs.length);
      expect(table.isValid()).toBe(true);
    }

    expect(table.keys().sort()).toEqual(reference.pairs.map((pair) => pair[0]).sort());
    expect(table.longestChain()).toBeGreaterThan(1); // collisions really happened
  });
});

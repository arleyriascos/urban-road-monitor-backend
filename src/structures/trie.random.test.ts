import { describe, expect, it } from 'vitest';
import { Trie } from './trie.js';

/** A small deterministic generator, so a failure can be repeated with its seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('Trie against a plain list', () => {
  it.each(Array.from({ length: 40 }, (_, i) => i + 1))('seed %i', (seed) => {
    const next = random(seed);
    const alphabet = 'abc ';
    const word = () =>
      Array.from({ length: Math.floor(next() * 6) }, () => alphabet[Math.floor(next() * 4)]).join(
        '',
      );

    const trie = new Trie<number>();
    const keys: { key: string; value: number }[] = [];
    for (let i = 0; i < 80; i += 1) {
      const key = word();
      trie.insert(key, i);
      keys.push({ key, value: i });
    }

    for (let q = 0; q < 40; q += 1) {
      const prefix = word().slice(0, 3);
      const limit = 1 + Math.floor(next() * 12);
      // The list answer: sort by key (stable, so same keys stay in insertion order).
      const expected = keys
        .filter((entry) => entry.key.startsWith(prefix))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .map((entry) => entry.value);

      expect(trie.withPrefix(prefix)).toEqual(expected);
      expect(trie.withPrefix(prefix, limit)).toEqual(expected.slice(0, limit));
      expect(trie.hasPrefix(prefix)).toBe(expected.length > 0);
    }
    expect(trie.size).toBe(new Set(keys.map((entry) => entry.key)).size);
  });
});

/**
 * Random changes and questions on the segment tree, compared with the slow but obvious way: a
 * plain array that is added up or joined from start to end. The seeds are fixed, so every run
 * does the same.
 */
import { describe, expect, it } from 'vitest';
import { SegmentTree, type Monoid } from './segment-tree.js';

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

/** A pair (sum, text): sum is commutative, text is not, so both kinds of mistake show up. */
interface Pair {
  total: number;
  text: string;
}
const pair: Monoid<Pair> = {
  identity: { total: 0, text: '' },
  combine: (a, b) => ({ total: a.total + b.total, text: a.text + b.text }),
};

describe('SegmentTree (random runs)', () => {
  for (let seed = 1; seed <= 40; seed++) {
    it(`agrees with the plain array (seed ${seed})`, () => {
      const random = seededRandom(seed);
      const size = Math.floor(random() * 60);
      const make = (): Pair => {
        const n = Math.floor(random() * 100);
        return { total: n, text: String.fromCharCode(33 + (n % 90)) };
      };
      const reference = Array.from({ length: size }, make);
      const tree = new SegmentTree(reference, pair);

      for (let step = 0; step < 200; step++) {
        if (size > 0 && random() < 0.3) {
          const index = Math.floor(random() * size);
          const value = make();
          reference[index] = value;
          tree.update(index, value);
        } else {
          const a = Math.floor(random() * (size + 1));
          const b = Math.floor(random() * (size + 1));
          const [from, to] = a <= b ? [a, b] : [b, a];
          const expected = reference.slice(from, to).reduce(pair.combine, pair.identity);
          expect(tree.query(from, to)).toEqual(expected);
        }
      }
      expect(tree.total()).toEqual(reference.reduce(pair.combine, pair.identity));
    });
  }
});

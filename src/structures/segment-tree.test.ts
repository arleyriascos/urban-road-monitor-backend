import { describe, expect, it } from 'vitest';
import { SegmentTree, type Monoid } from './segment-tree.js';

const sum: Monoid<number> = { identity: 0, combine: (a, b) => a + b };
const max: Monoid<number> = { identity: Number.NEGATIVE_INFINITY, combine: Math.max };
/** Joining text is associative but NOT commutative: it shows that the order is kept. */
const text: Monoid<string> = { identity: '', combine: (a, b) => a + b };

describe('SegmentTree', () => {
  it('adds up any range of a small list', () => {
    const tree = new SegmentTree([5, 3, 8, 1, 9, 2], sum);
    expect(tree.query(0, 6)).toBe(28);
    expect(tree.query(1, 4)).toBe(12);
    expect(tree.query(2, 3)).toBe(8);
    expect(tree.total()).toBe(28);
  });

  it('keeps the order for an operation that is not commutative, at any size', () => {
    for (let size = 1; size <= 17; size++) {
      const letters = Array.from({ length: size }, (_, i) => String.fromCharCode(97 + (i % 26)));
      const tree = new SegmentTree(letters, text);
      for (let from = 0; from <= size; from++) {
        for (let to = from; to <= size; to++) {
          expect(tree.query(from, to)).toBe(letters.slice(from, to).join(''));
        }
      }
    }
  });

  it('answers the identity for an empty range and for an empty tree', () => {
    const tree = new SegmentTree([4, 5], sum);
    expect(tree.query(1, 1)).toBe(0);
    expect(tree.query(2, 2)).toBe(0);
    const empty = new SegmentTree<number>([], max);
    expect(empty.size).toBe(0);
    expect(empty.total()).toBe(Number.NEGATIVE_INFINITY);
  });

  it('works with a maximum', () => {
    const tree = new SegmentTree([3, 9, 4, 7], max);
    expect(tree.query(0, 4)).toBe(9);
    expect(tree.query(2, 4)).toBe(7);
  });

  it('changes one position and every range that holds it', () => {
    const tree = new SegmentTree([1, 2, 3, 4, 5], sum);
    tree.update(2, 30);
    expect(tree.get(2)).toBe(30);
    expect(tree.query(0, 5)).toBe(42);
    expect(tree.query(0, 2)).toBe(3);
    expect(tree.query(2, 3)).toBe(30);
  });

  it('does not change the list it was built from', () => {
    const values = [1, 2, 3];
    const tree = new SegmentTree(values, sum);
    tree.update(0, 100);
    expect(values).toEqual([1, 2, 3]);
  });

  it('refuses a position or a range outside the list', () => {
    const tree = new SegmentTree([1, 2, 3], sum);
    expect(() => tree.get(3)).toThrow(RangeError);
    expect(() => tree.get(-1)).toThrow(RangeError);
    expect(() => tree.get(1.5)).toThrow(RangeError);
    expect(() => tree.update(3, 1)).toThrow(RangeError);
    expect(() => tree.query(-1, 2)).toThrow(RangeError);
    expect(() => tree.query(0, 4)).toThrow(RangeError);
    expect(() => tree.query(0.5, 2)).toThrow(RangeError);
  });

  it('answers a range that is "backwards" with the identity', () => {
    const tree = new SegmentTree([1, 2, 3], sum);
    expect(tree.query(2, 1)).toBe(0);
  });
});

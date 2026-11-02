/**
 * Random operations on the doubly linked list, compared with a plain array that keeps
 * the same values from head to tail. The seeds are fixed, so every run performs the
 * same operations.
 */
import { describe, expect, it } from 'vitest';
import { DoublyLinkedList, type ListNode } from './doubly-linked-list.js';

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

describe('DoublyLinkedList against a reference', () => {
  it.each([1, 2, 3, 4, 5])('matches the reference after every operation (seed %i)', (seed) => {
    const random = seededRandom(seed);
    const list = new DoublyLinkedList<number>();
    const reference: number[] = []; // values from head to tail
    const nodes: ListNode<number>[] = []; // nodes still in the list, in no order
    let next = 0;

    for (let step = 0; step < 3_000; step++) {
      const action = random();
      if (action < 0.4 || nodes.length === 0) {
        nodes.push(list.pushFront(next));
        reference.unshift(next);
        next++;
      } else if (action < 0.65) {
        const node = nodes[Math.floor(random() * nodes.length)];
        list.moveToFront(node);
        reference.splice(reference.indexOf(node.value), 1);
        reference.unshift(node.value);
      } else if (action < 0.85) {
        const index = Math.floor(random() * nodes.length);
        const [node] = nodes.splice(index, 1);
        list.remove(node);
        reference.splice(reference.indexOf(node.value), 1);
      } else {
        const value = list.popBack();
        expect(value).toBe(reference.pop());
        nodes.splice(
          nodes.findIndex((node) => node.value === value),
          1,
        );
      }

      expect(list.size).toBe(reference.length);
      expect(list.toArray()).toEqual(reference);
      expect(list.head?.value).toBe(reference[0]);
      expect(list.tail?.value).toBe(reference[reference.length - 1]);
      expect(list.isValid()).toBe(true);
    }
  });
});

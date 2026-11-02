import { describe, expect, it } from 'vitest';
import { DoublyLinkedList, ListError } from './doubly-linked-list.js';

function listOf(...values: string[]): DoublyLinkedList<string> {
  const list = new DoublyLinkedList<string>();
  for (const value of [...values].reverse()) list.pushFront(value);
  return list;
}

describe('DoublyLinkedList', () => {
  it('starts empty, with no head and no tail', () => {
    const list = new DoublyLinkedList<string>();
    expect(list.isEmpty()).toBe(true);
    expect(list.head).toBeNull();
    expect(list.tail).toBeNull();
    expect(list.isValid()).toBe(true);
  });

  it('a single node is both the head and the tail', () => {
    const list = new DoublyLinkedList<string>();
    const node = list.pushFront('a');

    expect(list.head).toBe(node);
    expect(list.tail).toBe(node);
    expect(node.prev).toBeNull();
    expect(node.next).toBeNull();
    expect(list.isValid()).toBe(true);
  });

  it('pushFront puts the newest value at the head', () => {
    const list = new DoublyLinkedList<string>();
    list.pushFront('c');
    list.pushFront('b');
    list.pushFront('a');

    expect(list.toArray()).toEqual(['a', 'b', 'c']);
    expect(list.head?.value).toBe('a');
    expect(list.tail?.value).toBe('c');
    expect(list.size).toBe(3);
  });

  it('links every node both ways', () => {
    const list = listOf('a', 'b', 'c');
    const middle = list.head?.next;

    expect(middle?.value).toBe('b');
    expect(middle?.prev?.value).toBe('a');
    expect(middle?.next?.value).toBe('c');
    expect(list.tail?.prev).toBe(middle);
  });

  it('moves a node from the middle to the head', () => {
    const list = listOf('a', 'b', 'c');
    const middle = list.head?.next;
    if (!middle) throw new Error('missing node');

    list.moveToFront(middle);

    expect(list.toArray()).toEqual(['b', 'a', 'c']);
    expect(list.isValid()).toBe(true);
  });

  it('moves the tail to the head and updates the tail', () => {
    const list = listOf('a', 'b', 'c');
    const tail = list.tail;
    if (!tail) throw new Error('missing node');

    list.moveToFront(tail);

    expect(list.toArray()).toEqual(['c', 'a', 'b']);
    expect(list.tail?.value).toBe('b');
    expect(list.isValid()).toBe(true);
  });

  it('moving the head to the head changes nothing', () => {
    const list = listOf('a', 'b');
    const head = list.head;
    if (!head) throw new Error('missing node');

    list.moveToFront(head);

    expect(list.toArray()).toEqual(['a', 'b']);
    expect(list.isValid()).toBe(true);
  });

  it.each([
    ['the head', 0, ['b', 'c']],
    ['the middle node', 1, ['a', 'c']],
    ['the tail', 2, ['a', 'b']],
  ])('removes %s', (_name, position, remaining) => {
    const list = listOf('a', 'b', 'c');
    let node = list.head;
    for (let i = 0; i < position; i++) node = node?.next ?? null;
    if (!node) throw new Error('missing node');

    list.remove(node);

    expect(list.toArray()).toEqual(remaining);
    expect(list.size).toBe(2);
    expect(list.isValid()).toBe(true);
  });

  it('removing the only node leaves the list empty', () => {
    const list = new DoublyLinkedList<string>();
    const node = list.pushFront('a');

    list.remove(node);

    expect(list.isEmpty()).toBe(true);
    expect(list.head).toBeNull();
    expect(list.tail).toBeNull();
    expect(list.isValid()).toBe(true);
  });

  it('popBack removes and returns the tail value', () => {
    const list = listOf('a', 'b', 'c');

    expect(list.popBack()).toBe('c');
    expect(list.popBack()).toBe('b');
    expect(list.popBack()).toBe('a');
    expect(list.popBack()).toBeUndefined();
    expect(list.isValid()).toBe(true);
  });

  it('refuses a node that was already removed', () => {
    const list = listOf('a', 'b');
    const head = list.head;
    if (!head) throw new Error('missing node');
    list.remove(head);

    expect(() => list.remove(head)).toThrow(ListError);
    expect(() => list.moveToFront(head)).toThrow(ListError);
    expect(list.toArray()).toEqual(['b']);
  });

  it('refuses a node of another list', () => {
    const list = listOf('a');
    const other = listOf('x');
    const foreign = other.head;
    if (!foreign) throw new Error('missing node');

    expect(() => list.remove(foreign)).toThrow('does not belong to this list');
    expect(() => list.moveToFront(foreign)).toThrow(ListError);
    expect(list.isValid()).toBe(true);
    expect(other.isValid()).toBe(true);
  });

  it('clear empties the list and detaches its nodes', () => {
    const list = listOf('a', 'b', 'c');
    const head = list.head;
    if (!head) throw new Error('missing node');

    list.clear();

    expect(list.isEmpty()).toBe(true);
    expect(list.isValid()).toBe(true);
    expect(() => list.remove(head)).toThrow(ListError);
  });

  it('the value of a node can be updated in place', () => {
    const list = listOf('a');
    const head = list.head;
    if (!head) throw new Error('missing node');

    head.value = 'z';

    expect(list.toArray()).toEqual(['z']);
  });

  it('isValid notices a broken link', () => {
    const list = listOf('a', 'b', 'c');
    const middle = list.head?.next;
    if (!middle) throw new Error('missing node');

    middle.prev = null; // a link the list would never leave like this

    expect(list.isValid()).toBe(false);
  });
});

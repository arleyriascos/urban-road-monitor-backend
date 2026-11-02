/**
 * Doubly linked list, written by hand, as the course presents it: every node holds a
 * value and two pointers, one to the next node and one to the previous one. The first
 * node is the head (cabeza) and the last one is the tail (cola); both are null when the
 * list is empty.
 *
 * The operations take and return nodes, so whoever keeps a node (the LRU cache keeps
 * them in its hash table) can move or remove it in O(1) without searching the list.
 *
 * Complexity: pushFront, moveToFront, remove and popBack are O(1).
 */
export class ListError extends Error {}

export class ListNode<T> {
  /** Toward the head; null for the head. Only the list changes it. */
  prev: ListNode<T> | null = null;
  /** Toward the tail; null for the tail. Only the list changes it. */
  next: ListNode<T> | null = null;
  /** The list the node belongs to; null once it is removed. */
  owner: DoublyLinkedList<T> | null;

  constructor(
    public value: T,
    owner: DoublyLinkedList<T>,
  ) {
    this.owner = owner;
  }
}

export class DoublyLinkedList<T> {
  private first: ListNode<T> | null = null;
  private last: ListNode<T> | null = null;
  private count = 0;

  /** The first node (cabeza), or null if the list is empty. */
  get head(): ListNode<T> | null {
    return this.first;
  }

  /** The last node (cola), or null if the list is empty. */
  get tail(): ListNode<T> | null {
    return this.last;
  }

  get size(): number {
    return this.count;
  }

  isEmpty(): boolean {
    return this.count === 0;
  }

  /** Put a value at the head and return its node. */
  pushFront(value: T): ListNode<T> {
    const node = new ListNode(value, this);
    this.linkAtFront(node);
    this.count++;
    return node;
  }

  /** Move a node of this list to the head. */
  moveToFront(node: ListNode<T>): void {
    this.checkOwner(node);
    if (node === this.first) {
      return;
    }
    this.unlink(node);
    this.linkAtFront(node);
  }

  /** Take a node out of this list; it cannot be used with the list again. */
  remove(node: ListNode<T>): void {
    this.checkOwner(node);
    this.unlink(node);
    node.owner = null;
    this.count--;
  }

  /** Remove the tail and return its value, or undefined if the list is empty. */
  popBack(): T | undefined {
    const node = this.last;
    if (!node) {
      return undefined;
    }
    this.remove(node);
    return node.value;
  }

  /** Remove every node. */
  clear(): void {
    for (let node = this.first; node;) {
      const next = node.next;
      node.prev = null;
      node.next = null;
      node.owner = null;
      node = next;
    }
    this.first = null;
    this.last = null;
    this.count = 0;
  }

  /** The values from the head to the tail. */
  toArray(): T[] {
    const values: T[] = [];
    for (let node = this.first; node; node = node.next) {
      values.push(node.value);
    }
    return values;
  }

  /**
   * Check the invariants walking both ways: the links agree, the head has no previous
   * node and the tail no next one, every node belongs to this list, and the count is
   * right. It is O(n), so it is meant for tests and for the presentation.
   */
  isValid(): boolean {
    if ((this.first === null) !== (this.last === null) || this.first?.prev || this.last?.next) {
      return false;
    }
    let forward = 0;
    let previous: ListNode<T> | null = null;
    for (let node = this.first; node; node = node.next) {
      if (node.prev !== previous || node.owner !== this || forward > this.count) {
        return false;
      }
      previous = node;
      forward++;
    }
    let backward = 0;
    for (let node = this.last; node && backward <= this.count; node = node.prev) {
      backward++;
    }
    return previous === this.last && forward === this.count && backward === this.count;
  }

  private linkAtFront(node: ListNode<T>): void {
    node.prev = null;
    node.next = this.first;
    if (this.first) {
      this.first.prev = node;
    } else {
      this.last = node; // the list was empty: the node is also the tail
    }
    this.first = node;
  }

  private unlink(node: ListNode<T>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.first = node.next; // it was the head
    }
    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.last = node.prev; // it was the tail
    }
    node.prev = null;
    node.next = null;
  }

  private checkOwner(node: ListNode<T>): void {
    if (node.owner !== this) {
      throw new ListError('the node does not belong to this list');
    }
  }
}

import { DoublyLinkedList, type ListNode } from './doubly-linked-list.js';
import { HashTable } from './hash-table.js';

/**
 * LRU (least recently used) cache, written by hand on the two structures:
 *
 * - The doubly linked list keeps the order of use: the head (cabeza) is the entry used
 *   most recently and the tail (cola) the one unused for the longest time.
 * - The hash table finds the list node of a key in O(1), so a hit can move that node
 *   to the head without searching the list.
 *
 * When a new key would go over the capacity, the tail is evicted. The capacity counts
 * entries, not bytes. There is no expiry by time: the route cache puts the version of
 * the road network in the key, so old routes stop matching and get evicted as new
 * ones come in.
 *
 * The cache does not copy values: whoever uses it must not change what it stores.
 *
 * Complexity: get, peek, set and delete are O(1) on average.
 */
export class LruCacheError extends Error {}

/** What each list node holds: the key too, so an evicted tail can leave the table. */
interface CacheEntry<V> {
  readonly key: string;
  value: V;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  capacity: number;
}

export class LruCache<V> {
  private readonly table = new HashTable<ListNode<CacheEntry<V>>>();
  private readonly order = new DoublyLinkedList<CacheEntry<V>>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new LruCacheError(`capacity must be a whole number of at least 1, got ${capacity}`);
    }
  }

  get size(): number {
    return this.order.size;
  }

  /** The value of the key, which becomes the most recently used. Counts a hit or a miss. */
  get(key: string): V | undefined {
    const node = this.table.get(key);
    if (!node) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    this.order.moveToFront(node);
    return node.value.value;
  }

  /** The value of the key without changing the order or the statistics. */
  peek(key: string): V | undefined {
    return this.table.get(key)?.value.value;
  }

  /** Store the value as the most recently used; evict the least recently used if full. */
  set(key: string, value: V): void {
    const existing = this.table.get(key);
    if (existing) {
      existing.value.value = value;
      this.order.moveToFront(existing);
      return;
    }
    this.table.set(key, this.order.pushFront({ key, value }));
    if (this.order.size > this.capacity) {
      const oldest = this.order.popBack();
      if (oldest) {
        this.table.delete(oldest.key);
        this.evictions++;
      }
    }
  }

  /** Remove the key. Returns false if it was not there. */
  delete(key: string): boolean {
    const node = this.table.get(key);
    if (!node) {
      return false;
    }
    this.order.remove(node);
    this.table.delete(key);
    return true;
  }

  /** Remove every entry. The statistics are kept. */
  clear(): void {
    this.order.clear();
    this.table.clear();
  }

  /** Keys from the most to the least recently used. */
  keys(): string[] {
    return this.order.toArray().map((entry) => entry.key);
  }

  stats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      size: this.size,
      capacity: this.capacity,
    };
  }

  /**
   * Check that the table and the list agree entry by entry, and that the size is within
   * the capacity. It is O(n), so it is meant for tests and for the presentation.
   */
  isValid(): boolean {
    if (!this.table.isValid() || !this.order.isValid()) {
      return false;
    }
    if (this.table.size !== this.order.size || this.order.size > this.capacity) {
      return false;
    }
    for (let node = this.order.head; node; node = node.next) {
      if (this.table.get(node.value.key) !== node) {
        return false;
      }
    }
    return true;
  }
}

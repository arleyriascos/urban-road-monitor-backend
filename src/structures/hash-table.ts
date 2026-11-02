import { fnv1a32 } from './fnv1a.js';

/**
 * Hash table with separate chaining, written by hand.
 *
 * An array of buckets; each bucket is a singly linked list with the entries whose key
 * falls in it. Two keys that fall in the same bucket (a collision) simply share its
 * list. The bucket of a key is its FNV-1a hash with the low bits kept; the number of
 * buckets is always a power of 2, so `hash & (buckets - 1)` replaces a division.
 *
 * When the load factor (entries / buckets) would go over 0.75, the buckets double and
 * every entry moves to its new bucket. That costs O(n) once in a while, so inserting
 * is O(1) amortized.
 *
 * Complexity: get, has, set and delete are O(1) on average; O(n) in the worst case,
 * if every key fell in the same bucket.
 */
export const MAX_LOAD_FACTOR = 0.75;
const DEFAULT_BUCKETS = 8;

/** One entry of a bucket's singly linked list. */
interface Entry<V> {
  readonly key: string;
  value: V;
  next: Entry<V> | null;
}

export class HashTableError extends Error {}

export class HashTable<V> {
  private buckets: (Entry<V> | null)[];
  private count = 0;

  constructor(initialBuckets = DEFAULT_BUCKETS) {
    if (!Number.isInteger(initialBuckets) || initialBuckets < 1 || !isPowerOfTwo(initialBuckets)) {
      throw new HashTableError(`initialBuckets must be a power of 2, got ${initialBuckets}`);
    }
    this.buckets = emptyBuckets<V>(initialBuckets);
  }

  /** Number of entries. */
  get size(): number {
    return this.count;
  }

  /** Number of buckets (always a power of 2). */
  get bucketCount(): number {
    return this.buckets.length;
  }

  /** Entries per bucket; it never goes over MAX_LOAD_FACTOR. */
  get loadFactor(): number {
    return this.count / this.buckets.length;
  }

  get(key: string): V | undefined {
    return this.find(key)?.value;
  }

  has(key: string): boolean {
    return this.find(key) !== null;
  }

  /** Insert the key, or replace its value if it is already there. */
  set(key: string, value: V): void {
    const existing = this.find(key);
    if (existing) {
      existing.value = value;
      return;
    }
    if ((this.count + 1) / this.buckets.length > MAX_LOAD_FACTOR) {
      this.grow();
    }
    const index = this.indexOf(key);
    // A new entry goes first in its bucket's list: O(1).
    this.buckets[index] = { key, value, next: this.buckets[index] };
    this.count++;
  }

  /** Remove the key. Returns false if it was not there. */
  delete(key: string): boolean {
    const index = this.indexOf(key);
    let previous: Entry<V> | null = null;
    let entry = this.buckets[index];
    while (entry) {
      if (entry.key === key) {
        if (previous) {
          previous.next = entry.next;
        } else {
          this.buckets[index] = entry.next;
        }
        this.count--;
        return true;
      }
      previous = entry;
      entry = entry.next;
    }
    return false;
  }

  /** Remove every entry and go back to the initial number of buckets. */
  clear(): void {
    this.buckets = emptyBuckets<V>(DEFAULT_BUCKETS);
    this.count = 0;
  }

  /** Every key, in no particular order. */
  keys(): string[] {
    const keys: string[] = [];
    for (const head of this.buckets) {
      for (let entry = head; entry; entry = entry.next) {
        keys.push(entry.key);
      }
    }
    return keys;
  }

  /** Length of the longest bucket list: how many keys collided at worst. */
  longestChain(): number {
    let longest = 0;
    for (const head of this.buckets) {
      let length = 0;
      for (let entry = head; entry; entry = entry.next) {
        length++;
      }
      longest = Math.max(longest, length);
    }
    return longest;
  }

  /**
   * Check the invariants: every entry is in the bucket of its hash, no key appears
   * twice, the count matches and the load factor is not over the limit.
   * It is O(n), so it is meant for tests and for the presentation.
   */
  isValid(): boolean {
    let total = 0;
    for (let index = 0; index < this.buckets.length; index++) {
      const seen: string[] = [];
      for (let entry = this.buckets[index]; entry; entry = entry.next) {
        if (this.indexOf(entry.key) !== index || seen.includes(entry.key)) {
          return false;
        }
        seen.push(entry.key);
        total++;
      }
    }
    return total === this.count && this.loadFactor <= MAX_LOAD_FACTOR;
  }

  private find(key: string): Entry<V> | null {
    for (let entry = this.buckets[this.indexOf(key)]; entry; entry = entry.next) {
      if (entry.key === key) {
        return entry;
      }
    }
    return null;
  }

  private indexOf(key: string): number {
    return fnv1a32(key) & (this.buckets.length - 1);
  }

  /** Double the buckets and move every entry to its new bucket (rehash). */
  private grow(): void {
    const old = this.buckets;
    this.buckets = emptyBuckets<V>(old.length * 2);
    for (const head of old) {
      let entry = head;
      while (entry) {
        const next = entry.next;
        const index = this.indexOf(entry.key);
        entry.next = this.buckets[index];
        this.buckets[index] = entry;
        entry = next;
      }
    }
  }
}

function emptyBuckets<V>(count: number): (Entry<V> | null)[] {
  return new Array<Entry<V> | null>(count).fill(null);
}

function isPowerOfTwo(value: number): boolean {
  return (value & (value - 1)) === 0;
}

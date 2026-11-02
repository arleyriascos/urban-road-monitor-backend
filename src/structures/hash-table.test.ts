import { describe, expect, it } from 'vitest';
import { fnv1a32 } from './fnv1a.js';
import { HashTable, HashTableError, MAX_LOAD_FACTOR } from './hash-table.js';

/** Two different keys whose hashes fall in the same bucket of a table with `buckets`. */
function collidingKeys(buckets: number): [string, string] {
  const firstBucket = fnv1a32('clave-0') & (buckets - 1);
  for (let i = 1; ; i++) {
    const key = `clave-${i}`;
    if ((fnv1a32(key) & (buckets - 1)) === firstBucket) {
      return ['clave-0', key];
    }
  }
}

describe('HashTable', () => {
  it('starts empty', () => {
    const table = new HashTable<number>();
    expect(table.size).toBe(0);
    expect(table.get('x')).toBeUndefined();
    expect(table.has('x')).toBe(false);
    expect(table.isValid()).toBe(true);
  });

  it('stores and finds values by key', () => {
    const table = new HashTable<string>();
    table.set('origen', 'Plaza de Nariño');
    table.set('destino', 'Unicentro');

    expect(table.get('origen')).toBe('Plaza de Nariño');
    expect(table.get('destino')).toBe('Unicentro');
    expect(table.has('origen')).toBe(true);
    expect(table.size).toBe(2);
  });

  it('replaces the value of a key that is already there', () => {
    const table = new HashTable<number>();
    table.set('k', 1);
    table.set('k', 2);

    expect(table.get('k')).toBe(2);
    expect(table.size).toBe(1);
  });

  it('removes a key and reports whether it was there', () => {
    const table = new HashTable<number>();
    table.set('a', 1);

    expect(table.delete('a')).toBe(true);
    expect(table.delete('a')).toBe(false);
    expect(table.has('a')).toBe(false);
    expect(table.size).toBe(0);
  });

  it('keeps colliding keys apart in the same bucket', () => {
    const table = new HashTable<string>(8);
    const [first, second] = collidingKeys(8);
    table.set(first, 'uno');
    table.set(second, 'dos');

    expect(table.longestChain()).toBe(2);
    expect(table.get(first)).toBe('uno');
    expect(table.get(second)).toBe('dos');
    expect(table.isValid()).toBe(true);
  });

  it('removes either colliding key without losing the other', () => {
    for (const removed of [0, 1]) {
      const table = new HashTable<string>(8);
      const keys = collidingKeys(8);
      table.set(keys[0], 'uno');
      table.set(keys[1], 'dos');

      table.delete(keys[removed]);

      const kept = keys[1 - removed];
      expect(table.has(keys[removed])).toBe(false);
      expect(table.get(kept)).toBe(removed === 0 ? 'dos' : 'uno');
      expect(table.isValid()).toBe(true);
    }
  });

  it('doubles its buckets before the load factor goes over 0.75', () => {
    const table = new HashTable<number>(8);
    for (let i = 0; i < 6; i++) table.set(`k${i}`, i);
    expect(table.bucketCount).toBe(8); // 6 / 8 = 0.75

    table.set('k6', 6); // 7 / 8 would be 0.875

    expect(table.bucketCount).toBe(16);
    expect(table.loadFactor).toBeLessThanOrEqual(MAX_LOAD_FACTOR);
  });

  it('keeps every entry when it grows many times', () => {
    const table = new HashTable<number>(1);
    for (let i = 0; i < 5_000; i++) table.set(`ruta-${i}`, i);

    expect(table.size).toBe(5_000);
    expect(table.bucketCount).toBe(8_192);
    expect(table.loadFactor).toBeLessThanOrEqual(MAX_LOAD_FACTOR);
    for (let i = 0; i < 5_000; i += 97) expect(table.get(`ruta-${i}`)).toBe(i);
    expect(table.isValid()).toBe(true);
  });

  it('a route cache of 200 entries grows to 512 buckets and stays there', () => {
    const table = new HashTable<number>();
    for (let i = 0; i < 200; i++) table.set(`ruta-${i}`, i);
    expect(table.bucketCount).toBe(512);
  });

  it('lists every key', () => {
    const table = new HashTable<number>();
    for (const key of ['a', 'b', 'c']) table.set(key, 0);
    expect(table.keys().sort()).toEqual(['a', 'b', 'c']);
  });

  it('clear removes everything', () => {
    const table = new HashTable<number>();
    for (let i = 0; i < 50; i++) table.set(`k${i}`, i);

    table.clear();

    expect(table.size).toBe(0);
    expect(table.keys()).toEqual([]);
    expect(table.bucketCount).toBe(8);
  });

  it('stores values of any type', () => {
    const table = new HashTable<{ segments: number[] }>();
    const route = { segments: [3381, 3382] };
    table.set('ruta', route);
    expect(table.get('ruta')).toBe(route);
  });

  it.each([0, 3, 6, -2, 1.5, Number.NaN])('rejects %s initial buckets', (buckets) => {
    expect(() => new HashTable(buckets)).toThrow(HashTableError);
  });
});

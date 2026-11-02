import { describe, expect, it } from 'vitest';
import { LruCache, LruCacheError } from './lru-cache.js';

describe('LruCache', () => {
  it('stores and returns values', () => {
    const cache = new LruCache<string>(3);
    cache.set('a', 'ruta A');

    expect(cache.get('a')).toBe('ruta A');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.size).toBe(1);
  });

  it('keeps the keys from the most to the least recently used', () => {
    const cache = new LruCache<number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    expect(cache.keys()).toEqual(['c', 'b', 'a']);
  });

  it('evicts the least recently used key when it is full', () => {
    const cache = new LruCache<number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    cache.set('d', 4);

    expect(cache.keys()).toEqual(['d', 'c', 'b']);
    expect(cache.peek('a')).toBeUndefined();
    expect(cache.size).toBe(3);
  });

  it('get makes a key recent, so it is not the next one evicted', () => {
    const cache = new LruCache<number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    cache.get('a');
    cache.set('d', 4);

    expect(cache.keys()).toEqual(['d', 'a', 'c']);
    expect(cache.peek('b')).toBeUndefined();
  });

  it('peek does not change the order', () => {
    const cache = new LruCache<number>(3);
    cache.set('a', 1);
    cache.set('b', 2);

    expect(cache.peek('a')).toBe(1);
    expect(cache.keys()).toEqual(['b', 'a']);
  });

  it('setting an existing key updates it and makes it recent, without evicting', () => {
    const cache = new LruCache<number>(2);
    cache.set('a', 1);
    cache.set('b', 2);

    cache.set('a', 10);

    expect(cache.keys()).toEqual(['a', 'b']);
    expect(cache.peek('a')).toBe(10);
    expect(cache.stats().evictions).toBe(0);
  });

  it('removes a key', () => {
    const cache = new LruCache<number>(3);
    cache.set('a', 1);
    cache.set('b', 2);

    expect(cache.delete('a')).toBe(true);
    expect(cache.delete('a')).toBe(false);
    expect(cache.keys()).toEqual(['b']);
    expect(cache.isValid()).toBe(true);
  });

  it('counts hits, misses and evictions; peek counts nothing', () => {
    const cache = new LruCache<number>(1);
    cache.set('a', 1);
    cache.get('a'); // hit
    cache.get('x'); // miss
    cache.peek('a');
    cache.set('b', 2); // evicts a

    expect(cache.stats()).toEqual({ hits: 1, misses: 1, evictions: 1, size: 1, capacity: 1 });
  });

  it('works with a capacity of 1', () => {
    const cache = new LruCache<string>(1);
    cache.set('a', 'uno');
    cache.set('b', 'dos');

    expect(cache.keys()).toEqual(['b']);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('dos');
    expect(cache.isValid()).toBe(true);
  });

  it('clear removes every entry and keeps the statistics', () => {
    const cache = new LruCache<number>(3);
    cache.set('a', 1);
    cache.get('a');

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.keys()).toEqual([]);
    expect(cache.stats().hits).toBe(1);
    cache.set('b', 2);
    expect(cache.get('b')).toBe(2);
    expect(cache.isValid()).toBe(true);
  });

  it('old route versions are evicted as new ones come in', () => {
    const cache = new LruCache<string>(200);
    for (let i = 0; i < 200; i++) cache.set(`ruta-${i}|version-1`, 'vieja');
    for (let i = 0; i < 200; i++) cache.set(`ruta-${i}|version-2`, 'nueva');

    expect(cache.size).toBe(200);
    expect(cache.keys().every((key) => key.endsWith('|version-2'))).toBe(true);
    expect(cache.stats().evictions).toBe(200);
  });

  it('does not copy the stored value', () => {
    const cache = new LruCache<{ segments: number[] }>(2);
    const route = { segments: [3381] };
    cache.set('ruta', route);
    expect(cache.get('ruta')).toBe(route);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a capacity of %s',
    (capacity) => {
      expect(() => new LruCache(capacity)).toThrow(LruCacheError);
    },
  );
});

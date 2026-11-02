import { describe, expect, it } from 'vitest';
import { fnv1a32 } from './fnv1a.js';

describe('fnv1a32', () => {
  // Published test values of FNV-1a 32: they prove it is the real function.
  it.each([
    ['', 0x811c9dc5],
    ['a', 0xe40c292c],
    ['foobar', 0xbf9cf968],
  ])('hashes %j to its published value', (text, expected) => {
    expect(fnv1a32(text)).toBe(expected);
  });

  it('hashes the bytes of the text in UTF-8', () => {
    expect(fnv1a32('ñandú')).toBe(0xb48f3ccb);
  });

  it('hashes a route cache key', () => {
    expect(fnv1a32('1.2136,-77.2811|1.2150,-77.2790|1|940ab035')).toBe(0x7bb5c936);
  });

  it('always gives an unsigned 32-bit integer', () => {
    for (const text of ['', 'x', 'una clave más larga', '🚧 bache']) {
      const hash = fnv1a32(text);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThan(2 ** 32);
    }
  });

  it('gives the same hash for the same text and different ones for similar texts', () => {
    expect(fnv1a32('ruta-1')).toBe(fnv1a32('ruta-1'));
    expect(fnv1a32('ruta-1')).not.toBe(fnv1a32('ruta-2'));
  });
});

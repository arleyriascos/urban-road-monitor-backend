import { describe, expect, it } from 'vitest';
import { Trie } from './trie.js';

function build(words: string[]): Trie<string> {
  const trie = new Trie<string>();
  for (const word of words) trie.insert(word, word);
  return trie;
}

describe('Trie', () => {
  it('starts empty', () => {
    const trie = new Trie<string>();
    expect(trie.size).toBe(0);
    expect(trie.withPrefix('')).toEqual([]);
    expect(trie.hasPrefix('')).toBe(false);
    expect(trie.hasKey('a')).toBe(false);
  });

  it('finds the keys that start with a prefix, in alphabetical order', () => {
    const trie = build(['carrera 9', 'calle 18', 'calle 5', 'avenida', 'calle']);
    expect(trie.withPrefix('call')).toEqual(['calle', 'calle 18', 'calle 5']);
    expect(trie.withPrefix('c')).toEqual(['calle', 'calle 18', 'calle 5', 'carrera 9']);
    expect(trie.withPrefix('')).toEqual(['avenida', 'calle', 'calle 18', 'calle 5', 'carrera 9']);
    expect(trie.withPrefix('x')).toEqual([]);
  });

  it('includes the key that is the prefix itself', () => {
    expect(build(['calle', 'calles']).withPrefix('calle')).toEqual(['calle', 'calles']);
  });

  it('respects the limit', () => {
    const trie = build(['a1', 'a2', 'a3', 'a4']);
    expect(trie.withPrefix('a', 2)).toEqual(['a1', 'a2']);
    expect(trie.withPrefix('a', 0)).toEqual([]);
  });

  it('keeps several values under one key, in the order they were added', () => {
    const trie = new Trie<number>();
    trie.insert('calle 1', 10);
    trie.insert('calle 1', 20);
    trie.insert('calle 2', 30);
    expect(trie.size).toBe(2);
    expect(trie.get('calle 1')).toEqual([10, 20]);
    expect(trie.withPrefix('calle')).toEqual([10, 20, 30]);
  });

  it('tells a key from a prefix', () => {
    const trie = build(['calle']);
    expect(trie.hasKey('calle')).toBe(true);
    expect(trie.hasKey('cal')).toBe(false);
    expect(trie.hasPrefix('cal')).toBe(true);
    expect(trie.hasPrefix('calles')).toBe(false);
    expect(trie.get('cal')).toEqual([]);
  });

  it('handles letters outside the basic alphabet, one by one', () => {
    const trie = build(['ñandú', '😀 plaza']);
    expect(trie.withPrefix('ñ')).toEqual(['ñandú']);
    expect(trie.withPrefix('😀')).toEqual(['😀 plaza']);
  });

  it('does not overflow the stack with a very long key', () => {
    const long = 'a'.repeat(50_000);
    const trie = build([long]);
    expect(trie.withPrefix('a')).toEqual([long]);
  });

  it('returns copies, so the caller cannot change what is stored', () => {
    const trie = new Trie<number>();
    trie.insert('a', 1);
    trie.get('a').push(99);
    expect(trie.get('a')).toEqual([1]);
  });
});

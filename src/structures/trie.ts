interface TrieNode<V> {
  children: Map<string, TrieNode<V>>;
  /** What was stored under the key that ends exactly here, in the order it was added. */
  values: V[];
}

function createNode<V>(): TrieNode<V> {
  return { children: new Map(), values: [] };
}

/**
 * A trie (prefix tree): keys are spelled letter by letter down a tree, so everything that starts
 * with a prefix hangs below one node. Finding the keys that start with "cal" costs the length of
 * "cal" plus what is collected, however many keys the trie holds.
 *
 * Several values can share a key. Results come out in alphabetical order of their keys and, within
 * a key, in the order the values were added, so the same trie always answers the same way.
 */
export class Trie<V> {
  private readonly root = createNode<V>();
  private keyCount = 0;

  /** How many different keys the trie holds. */
  get size(): number {
    return this.keyCount;
  }

  insert(key: string, value: V): void {
    let node = this.root;
    for (const letter of key) {
      let next = node.children.get(letter);
      if (!next) {
        next = createNode<V>();
        node.children.set(letter, next);
      }
      node = next;
    }
    if (node.values.length === 0) this.keyCount += 1;
    node.values.push(value);
  }

  /** The values stored under exactly this key. */
  get(key: string): V[] {
    return [...(this.walk(key)?.values ?? [])];
  }

  hasKey(key: string): boolean {
    return (this.walk(key)?.values.length ?? 0) > 0;
  }

  /** True if some key starts with `prefix` (the empty prefix matches whatever there is). */
  hasPrefix(prefix: string): boolean {
    const node = this.walk(prefix);
    return node !== undefined && (node.values.length > 0 || node.children.size > 0);
  }

  /** The values whose keys start with `prefix`, at most `limit` of them. */
  withPrefix(prefix: string, limit = Number.POSITIVE_INFINITY): V[] {
    const found: V[] = [];
    const start = this.walk(prefix);
    if (!start || limit <= 0) return found;

    // Iterative depth-first walk in alphabetical order (a stack, with the children pushed in
    // reverse), so a very long key cannot overflow the call stack.
    const stack: TrieNode<V>[] = [start];
    while (stack.length > 0 && found.length < limit) {
      const node = stack.pop()!;
      for (const value of node.values) {
        if (found.length >= limit) break;
        found.push(value);
      }
      const letters = [...node.children.keys()].sort();
      for (let i = letters.length - 1; i >= 0; i -= 1) {
        stack.push(node.children.get(letters[i]!)!);
      }
    }
    return found;
  }

  private walk(key: string): TrieNode<V> | undefined {
    let node: TrieNode<V> | undefined = this.root;
    for (const letter of key) {
      node = node.children.get(letter);
      if (!node) return undefined;
    }
    return node;
  }
}

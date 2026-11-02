/**
 * FNV-1a hash of 32 bits (Fowler-Noll-Vo).
 *
 * For each byte of the text in UTF-8: first XOR the byte into the hash, then multiply
 * by the FNV prime. It is short, well known and spreads similar keys well, which is
 * what the hash table needs. It is not a cryptographic hash.
 */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const encoder = new TextEncoder();

/** Hash of a text as an unsigned 32-bit integer (0 to 2^32 - 1). */
export function fnv1a32(text: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of encoder.encode(text)) {
    hash ^= byte;
    // Math.imul multiplies as 32-bit integers, like the original algorithm.
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

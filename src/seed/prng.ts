/** A function that returns a number from 0 (included) to 1 (excluded). */
export type Random = () => number;

/**
 * Deterministic random numbers (mulberry32 algorithm): the same seed always gives the
 * same sequence, so the test potholes are identical every time the script runs.
 */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Whole number between min and max, both included. */
export function randomInt(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

export function pick<T>(random: Random, items: readonly T[]): T {
  if (items.length === 0) throw new Error('Cannot pick from an empty list');
  return items[Math.floor(random() * items.length)];
}

/** Picks a value; the chance of each one is proportional to its weight. */
export function weightedPick<T>(
  random: Random,
  options: readonly { value: T; weight: number }[],
): T {
  const total = options.reduce((sum, option) => sum + option.weight, 0);
  let target = random() * total;
  for (const option of options) {
    target -= option.weight;
    if (target < 0) return option.value;
  }
  return options[options.length - 1].value;
}

/** Returns a shuffled copy (Fisher-Yates). The original list is not changed. */
export function shuffle<T>(random: Random, items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

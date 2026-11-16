/** One row of severity_levels: the share of the picture a box covers, from min up to max. */
export interface SeverityLevel {
  id: number;
  name: string;
  minAreaRatio: number;
  maxAreaRatio: number;
}

/**
 * The severity of a pothole from the share of the picture its box covers (0 to 1).
 *
 * A level takes its lower limit and leaves the upper one to the next level, so a box that
 * covers exactly 4 % is "grave", not "moderado". The last level also takes the 100 %.
 * The levels come from the table, so the rule has a single owner.
 * Returns undefined only if no level holds the value, which means the table is wrong.
 */
export function classifySeverity(
  areaRatio: number,
  levels: readonly SeverityLevel[],
): SeverityLevel | undefined {
  if (!Number.isFinite(areaRatio) || areaRatio < 0 || areaRatio > 1) {
    return undefined;
  }
  const ordered = [...levels].sort((a, b) => a.minAreaRatio - b.minAreaRatio);
  const last = ordered.at(-1);
  return ordered.find(
    (level) =>
      areaRatio >= level.minAreaRatio &&
      (areaRatio < level.maxAreaRatio || (level === last && areaRatio <= level.maxAreaRatio)),
  );
}

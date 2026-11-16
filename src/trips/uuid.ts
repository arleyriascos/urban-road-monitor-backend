const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a text is a UUID. A text that is not one must never reach a query that casts it
 * (::uuid): PostgreSQL would fail with a 500 instead of the "not found" the person deserves.
 */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

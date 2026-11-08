/**
 * Whether an error is Prisma's "unique constraint failed" (code P2002). It looks at the code
 * and nothing else, so it works for the error of any query, inside a transaction or not.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * The form of a street name used to search: lower case, no accents, one space between words.
 * "  Avenida  Pasto  " and "AVENIDA PASTÓ" both become "avenida pasto" (and "ñ" becomes "n").
 */
export function normalizeName(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

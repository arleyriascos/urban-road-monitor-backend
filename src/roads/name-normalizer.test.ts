import { describe, expect, it } from 'vitest';
import { normalizeName } from './name-normalizer.js';

describe('normalizeName', () => {
  it.each([
    ['Calle 18', 'calle 18'],
    ['  Avenida   Pasto  ', 'avenida pasto'],
    ['AVENIDA PASTÓ', 'avenida pasto'],
    ['Carrera 9ª Norte', 'carrera 9a norte'],
    ['Calle del Cañón', 'calle del canon'],
    ['Calle 5 - Sur', 'calle 5 sur'],
    ['Diagonal 23, #4', 'diagonal 23 4'],
    ['', ''],
    ['   ', ''],
    ['---', ''],
  ])('%j → %j', (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });

  it('is idempotent', () => {
    const once = normalizeName('  Calle  DÉ  Las Ñandúes ');
    expect(normalizeName(once)).toBe(once);
  });
});

import { describe, expect, it } from 'vitest';
import { isUuid } from './uuid.js';

describe('isUuid', () => {
  it.each([
    '0b6f5a9e-6f5e-4f6e-9d63-1c8f3a2b7d10',
    '0B6F5A9E-6F5E-4F6E-9D63-1C8F3A2B7D10',
    '00000000-0000-0000-0000-000000000000',
  ])('accepts %s', (value) => {
    expect(isUuid(value)).toBe(true);
  });

  it.each([
    '',
    '123',
    '0b6f5a9e6f5e4f6e9d631c8f3a2b7d10',
    '0b6f5a9e-6f5e-4f6e-9d63-1c8f3a2b7d1',
    '0b6f5a9e-6f5e-4f6e-9d63-1c8f3a2b7d10 ',
    'zb6f5a9e-6f5e-4f6e-9d63-1c8f3a2b7d10',
    "'; DROP TABLE trips; --",
  ])('refuses "%s"', (value) => {
    expect(isUuid(value)).toBe(false);
  });
});

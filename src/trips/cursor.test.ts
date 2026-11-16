import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor.js';

const CURSOR = {
  startedAt: new Date('2026-11-16T12:00:00.123Z'),
  id: '0b6f5a9e-6f5e-4f6e-9d63-1c8f3a2b7d10',
};

describe('trip cursor', () => {
  it('gives back what it was given', () => {
    expect(decodeCursor(encodeCursor(CURSOR))).toEqual(CURSOR);
  });

  it('is text that is safe in a URL', () => {
    expect(encodeCursor(CURSOR)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('does not show the id to someone who glances at it', () => {
    expect(encodeCursor(CURSOR)).not.toContain(CURSOR.id);
  });

  it.each([
    '',
    'not a cursor',
    'AAAA',
    Buffer.from('2026-11-16T12:00:00.000Z|not-a-uuid').toString('base64url'),
    Buffer.from('yesterday|0b6f5a9e-6f5e-4f6e-9d63-1c8f3a2b7d10').toString('base64url'),
    Buffer.from('2026-11-16|0b6f5a9e-6f5e-4f6e-9d63-1c8f3a2b7d10').toString('base64url'),
    Buffer.from('2026-11-16T12:00:00.000Z|0b6f5a9e-6f5e-4f6e-9d63-1c8f3a2b7d10|x').toString(
      'base64url',
    ),
    'a'.repeat(300),
  ])('refuses %j', (text) => {
    expect(decodeCursor(text)).toBeNull();
  });
});

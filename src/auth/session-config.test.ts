import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  SESSION_RENEW_EVERY_MS,
  initialExpiry,
  isDueForRenewal,
  renewedExpiry,
} from './session-config.js';

const created = new Date('2026-11-01T10:00:00Z');

describe('initialExpiry', () => {
  it('is seven days after the opening', () => {
    expect(initialExpiry(created).toISOString()).toBe('2026-11-08T10:00:00.000Z');
  });
});

describe('renewedExpiry', () => {
  it('adds seven days to the moment of the renewal', () => {
    const now = new Date(created.getTime() + 3 * DAY_MS);
    expect(renewedExpiry(created, now).toISOString()).toBe('2026-11-11T10:00:00.000Z');
  });

  it('never goes past 30 days after the session was created', () => {
    const now = new Date(created.getTime() + 28 * DAY_MS);
    expect(renewedExpiry(created, now).toISOString()).toBe('2026-12-01T10:00:00.000Z');
  });

  it('stays at the 30-day limit when it is already there', () => {
    const now = new Date(created.getTime() + 29.5 * DAY_MS);
    expect(renewedExpiry(created, now).getTime()).toBe(created.getTime() + 30 * DAY_MS);
  });
});

describe('isDueForRenewal', () => {
  const expiresAt = initialExpiry(created);

  it('is not due right after the session was opened', () => {
    expect(isDueForRenewal(expiresAt, created)).toBe(false);
  });

  it('is not due a minute before the hour is over', () => {
    const now = new Date(created.getTime() + SESSION_RENEW_EVERY_MS - 60_000);
    expect(isDueForRenewal(expiresAt, now)).toBe(false);
  });

  it('is not due exactly when the hour is over (the renewal time is included)', () => {
    const now = new Date(created.getTime() + SESSION_RENEW_EVERY_MS);
    expect(isDueForRenewal(expiresAt, now)).toBe(false);
  });

  it('is due one second after the hour', () => {
    const now = new Date(created.getTime() + SESSION_RENEW_EVERY_MS + 1000);
    expect(isDueForRenewal(expiresAt, now)).toBe(true);
  });

  it('is due again an hour after a renewal, never before', () => {
    const renewedAt = new Date(created.getTime() + 2 * DAY_MS);
    const renewed = renewedExpiry(created, renewedAt);
    expect(isDueForRenewal(renewed, new Date(renewedAt.getTime() + 30 * 60_000))).toBe(false);
    expect(isDueForRenewal(renewed, new Date(renewedAt.getTime() + 61 * 60_000))).toBe(true);
  });
});

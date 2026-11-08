import { isIP } from 'node:net';
import { USER_AGENT_MAX_LENGTH } from './session-config.js';

/** The user agent cut to the length the database keeps; empty or missing becomes null. */
export function trimUserAgent(userAgent: string | undefined | null): string | null {
  const text = userAgent?.trim();
  if (!text) {
    return null;
  }
  return text.length > USER_AGENT_MAX_LENGTH ? text.slice(0, USER_AGENT_MAX_LENGTH) : text;
}

/** The first `count` groups of an IPv6 address written in full, or null if it is not one. */
function ipv6Groups(address: string): string[] | null {
  const halves = address.split('::');
  if (halves.length > 2) {
    return null;
  }
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }
  const missing = 8 - head.length - tail.length;
  return missing < 1 ? null : [...head, ...Array<string>(missing).fill('0'), ...tail];
}

/**
 * An IP address with its last part cut off, so it points to a neighbourhood and not to a
 * person: an IPv4 address keeps its first three numbers (203.0.113.0) and an IPv6 address
 * its first three groups (2001:db8:85a3::). It is only kept for failed attempts, where it
 * helps to see abuse. Anything that is not an IP address becomes null.
 */
export function anonymizeIp(address: string | undefined | null): string | null {
  const text = address?.trim();
  if (!text) {
    return null;
  }

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(text);
  const candidate = mapped?.[1] ?? text;

  const version = isIP(candidate);
  if (version === 4) {
    const parts = candidate.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  if (version === 6) {
    const withoutZone = candidate.split('%')[0] ?? candidate;
    const groups = ipv6Groups(withoutZone);
    if (!groups) {
      return null;
    }
    return `${groups[0]}:${groups[1]}:${groups[2]}::`.toLowerCase();
  }
  return null;
}

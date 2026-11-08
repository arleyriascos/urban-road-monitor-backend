import { describe, expect, it } from 'vitest';
import { anonymizeIp, trimUserAgent } from './privacy.js';

describe('trimUserAgent', () => {
  it('keeps a normal user agent as it is', () => {
    expect(trimUserAgent('Mozilla/5.0 (Linux; Android 14) Chrome/130')).toBe(
      'Mozilla/5.0 (Linux; Android 14) Chrome/130',
    );
  });

  it('cuts one longer than 255 characters to exactly 255', () => {
    expect(trimUserAgent('a'.repeat(400))).toHaveLength(255);
    expect(trimUserAgent('a'.repeat(255))).toHaveLength(255);
  });

  it.each([[undefined], [null], [''], ['   ']])('turns %j into null', (value) => {
    expect(trimUserAgent(value)).toBeNull();
  });
});

describe('anonymizeIp', () => {
  it('zeroes the last number of an IPv4 address', () => {
    expect(anonymizeIp('203.0.113.77')).toBe('203.0.113.0');
  });

  it('treats an IPv4 address inside IPv6 as IPv4', () => {
    expect(anonymizeIp('::ffff:203.0.113.77')).toBe('203.0.113.0');
  });

  it.each([
    ['2001:db8:85a3:8a2e:370:7334:1:2', '2001:db8:85a3::'],
    ['2001:DB8:85A3::8a2e:370:7334', '2001:db8:85a3::'],
    ['2001:db8::1', '2001:db8:0::'],
    ['::1', '0:0:0::'],
  ])('keeps the first three groups of the IPv6 address %s', (address, expected) => {
    expect(anonymizeIp(address)).toBe(expected);
  });

  it('ignores the zone of a link-local address', () => {
    expect(anonymizeIp('fe80::1%eth0')).toBe('fe80:0:0::');
  });

  it.each([
    [undefined],
    [null],
    [''],
    ['not an ip'],
    ['999.1.1.1'],
    ['1.2.3'],
    ['1:2:3:4:5:6:7:8:9'],
  ])('turns %j into null', (value) => {
    expect(anonymizeIp(value)).toBeNull();
  });

  it('never returns the original address', () => {
    for (const address of ['203.0.113.77', '2001:db8:85a3:8a2e:370:7334:1:2']) {
      expect(anonymizeIp(address)).not.toBe(address);
    }
  });
});

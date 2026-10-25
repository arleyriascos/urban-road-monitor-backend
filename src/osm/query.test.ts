import { describe, expect, it } from 'vitest';
import { DEFAULT_BBOX } from './config.js';
import { buildOverpassQuery } from './query.js';

describe('buildOverpassQuery', () => {
  const query = buildOverpassQuery(DEFAULT_BBOX);

  it('asks for JSON with the default timeout', () => {
    expect(query.startsWith('[out:json][timeout:180];')).toBe(true);
  });

  it('uses the order south, west, north, east', () => {
    expect(query).toContain('(1.17,-77.32,1.25,-77.24)');
  });

  it('filters the 8 road types of the catalog', () => {
    expect(query).toContain(
      '["highway"~"^(trunk|primary|secondary|tertiary|residential|living_street|service|unclassified)$"]',
    );
  });

  it('asks for the geometry of every way', () => {
    expect(query.trim().endsWith('out geom;')).toBe(true);
  });

  it('accepts another timeout', () => {
    expect(buildOverpassQuery(DEFAULT_BBOX, 60)).toContain('[timeout:60]');
  });
});

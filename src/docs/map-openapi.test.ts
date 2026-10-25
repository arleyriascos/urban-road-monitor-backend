import { describe, expect, it } from 'vitest';
import { mapPaths, mapSchemas, mapTags } from './map-openapi.js';

describe('map OpenAPI description', () => {
  it('describes the three map endpoints, all as GET', () => {
    expect(Object.keys(mapPaths).sort()).toEqual([
      '/api/potholes',
      '/api/road-network/stats',
      '/api/road-segments',
    ]);
    for (const path of Object.values(mapPaths)) {
      expect(Object.keys(path)).toEqual(['get']);
    }
  });

  it('has a Map tag and every endpoint uses it', () => {
    expect(mapTags.map((tag) => tag.name)).toEqual(['Map']);
    for (const path of Object.values(mapPaths)) {
      expect(path.get.tags).toEqual(['Map']);
    }
  });

  it('only references schemas that exist', () => {
    const known = new Set([...Object.keys(mapSchemas), 'Error']);
    const text = JSON.stringify({ mapPaths, mapSchemas });
    const references = [...text.matchAll(/#\/components\/schemas\/(\w+)/g)].map(
      (match) => match[1],
    );

    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(known.has(reference), `missing schema ${reference}`).toBe(true);
    }
  });

  it('documents the includeRepaired query parameter and the 400 answer', () => {
    const potholes = mapPaths['/api/potholes'].get;
    expect(potholes.parameters[0].name).toBe('includeRepaired');
    expect(Object.keys(potholes.responses)).toContain('400');
  });
});

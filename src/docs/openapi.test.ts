import { describe, expect, it } from 'vitest';
import { openApiDocument } from './openapi.js';

describe('openApiDocument', () => {
  it('keeps the health endpoints and adds the map endpoints', () => {
    expect(Object.keys(openApiDocument.paths).sort()).toEqual([
      '/api/health',
      '/api/hello',
      '/api/potholes',
      '/api/road-network/stats',
      '/api/road-segments',
    ]);
  });

  it('lists the Health and Map tags', () => {
    expect(openApiDocument.tags.map((tag) => tag.name)).toEqual(['Health', 'Map']);
  });

  it('keeps the existing schemas and adds the map schemas', () => {
    const schemas = Object.keys(openApiDocument.components.schemas);
    expect(schemas).toEqual(
      expect.arrayContaining([
        'Error',
        'HealthReport',
        'HelloMessage',
        'SegmentCollection',
        'NetworkStats',
      ]),
    );
  });

  it('can be sent as JSON', () => {
    expect(() => JSON.stringify(openApiDocument)).not.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { openApiDocument } from './openapi.js';

describe('openApiDocument', () => {
  it('keeps the health and map endpoints and adds the internal one', () => {
    expect(Object.keys(openApiDocument.paths).sort()).toEqual([
      '/api/health',
      '/api/hello',
      '/api/potholes',
      '/api/road-network/stats',
      '/api/road-segments',
      '/internal/graph',
    ]);
  });

  it('lists the Health, Map and Internal tags', () => {
    expect(openApiDocument.tags.map((tag) => tag.name)).toEqual(['Health', 'Map', 'Internal']);
  });

  it('declares the bearer scheme used by the internal endpoint', () => {
    expect(openApiDocument.components.securitySchemes.internalToken).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
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
        'RoadGraph',
      ]),
    );
  });

  it('can be sent as JSON', () => {
    expect(() => JSON.stringify(openApiDocument)).not.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { openApiDocument } from './openapi.js';

describe('openApiDocument', () => {
  it('lists the health, map, route and internal endpoints', () => {
    expect(Object.keys(openApiDocument.paths).sort()).toEqual([
      '/api/health',
      '/api/hello',
      '/api/potholes',
      '/api/road-network/stats',
      '/api/road-segments',
      '/api/routes',
      '/internal/graph',
    ]);
  });

  it('lists the Health, Map, Routes and Internal tags', () => {
    expect(openApiDocument.tags.map((tag) => tag.name)).toEqual([
      'Health',
      'Map',
      'Routes',
      'Internal',
    ]);
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
        'RouteRequest',
        'RouteAnswer',
      ]),
    );
  });

  it('can be sent as JSON', () => {
    expect(() => JSON.stringify(openApiDocument)).not.toThrow();
  });
});

describe('route documentation', () => {
  it('documents every answer of POST /api/routes', () => {
    const responses = openApiDocument.paths['/api/routes'].post.responses;
    expect(Object.keys(responses).sort()).toEqual(['200', '400', '404', '422', '429', '503']);
  });

  it('only references schemas that exist', () => {
    const known = new Set(Object.keys(openApiDocument.components.schemas));
    const text = JSON.stringify(openApiDocument);
    for (const match of text.matchAll(/#\/components\/schemas\/(\w+)/g)) {
      expect(known.has(match[1]), `missing schema ${match[1]}`).toBe(true);
    }
  });

  it('documents the route cache in the health report', () => {
    const health = openApiDocument.components.schemas.HealthReport as {
      properties: Record<string, unknown>;
    };
    expect(health.properties.routeCache).toBeDefined();
  });
});

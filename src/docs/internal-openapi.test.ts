import { describe, expect, it } from 'vitest';
import {
  internalPaths,
  internalSchemas,
  internalSecuritySchemes,
  internalTags,
} from './internal-openapi.js';

describe('internal OpenAPI description', () => {
  it('describes only GET /internal/graph', () => {
    expect(Object.keys(internalPaths)).toEqual(['/internal/graph']);
    expect(Object.keys(internalPaths['/internal/graph'])).toEqual(['get']);
  });

  it('puts the endpoint under the Internal tag', () => {
    expect(internalTags.map((tag) => tag.name)).toEqual(['Internal']);
    expect(internalPaths['/internal/graph'].get.tags).toEqual(['Internal']);
  });

  it('requires the internal bearer token', () => {
    const operation = internalPaths['/internal/graph'].get;
    expect(operation.security).toEqual([{ internalToken: [] }]);
    expect(Object.keys(internalSecuritySchemes)).toEqual(['internalToken']);
  });

  it('documents the 200, 401, 404 and 503 answers', () => {
    expect(Object.keys(internalPaths['/internal/graph'].get.responses).sort()).toEqual([
      '200',
      '401',
      '404',
      '503',
    ]);
  });

  it('describes every field the AI service reads', () => {
    expect(internalSchemas.RoadGraph.required).toEqual(['version', 'nodes', 'segments']);
    expect(internalSchemas.GraphNode.required).toEqual(['id', 'latitude', 'longitude']);
    expect(internalSchemas.GraphSegment.required).toEqual([
      'id',
      'fromNodeId',
      'toNodeId',
      'lengthM',
      'damageScore',
      'isOneway',
    ]);
  });

  it('only references schemas that exist', () => {
    const known = new Set([...Object.keys(internalSchemas), 'Error']);
    const text = JSON.stringify({ internalPaths, internalSchemas });
    const references = [...text.matchAll(/#\/components\/schemas\/(\w+)/g)].map(
      (match) => match[1],
    );

    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(known.has(reference), `missing schema ${reference}`).toBe(true);
    }
  });
});

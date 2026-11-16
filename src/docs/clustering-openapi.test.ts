import { describe, expect, it } from 'vitest';
import { CLUSTERING_REQUESTS_PER_MINUTE } from '../middlewares/rate-limit.js';
import { clusteringPaths, clusteringTags } from './clustering-openapi.js';
import { openApiDocument } from './openapi.js';

describe('clustering documentation', () => {
  it('describes both operations under the Clustering tag, with a session', () => {
    expect(Object.keys(clusteringPaths)).toEqual(['/api/clustering/runs']);
    expect(Object.keys(clusteringPaths['/api/clustering/runs']).sort()).toEqual(['get', 'post']);
    for (const operation of Object.values(clusteringPaths['/api/clustering/runs'])) {
      expect(operation.tags).toEqual(['Clustering']);
      expect(operation.security).toEqual([{ sessionToken: [] }]);
      expect(Object.keys(operation.responses)).toEqual(
        expect.arrayContaining(['401', '403', '429']),
      );
    }
  });

  it('answers 202 and 409 where a run is started', () => {
    const responses = Object.keys(clusteringPaths['/api/clustering/runs'].post.responses);
    expect(responses).toEqual(expect.arrayContaining(['202', '409', '503']));
  });

  it('is part of the main document and says the limit', () => {
    expect(Object.keys(openApiDocument.paths)).toContain('/api/clustering/runs');
    expect(openApiDocument.components.schemas).toHaveProperty('ClusteringOverview');
    expect(clusteringTags[0]!.description).toContain(
      `${CLUSTERING_REQUESTS_PER_MINUTE} requests per minute`,
    );
  });

  it('uses only schemas that exist', () => {
    const text =
      JSON.stringify(clusteringPaths) + JSON.stringify(openApiDocument.components.schemas);
    const names = [...text.matchAll(/#\/components\/schemas\/(\w+)/g)].map((match) => match[1]!);
    const known = new Set(Object.keys(openApiDocument.components.schemas));
    expect(names.filter((name) => !known.has(name))).toEqual([]);
  });
});

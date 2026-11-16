import { describe, expect, it } from 'vitest';
import { SUMMARY_REQUESTS_PER_MINUTE } from '../middlewares/rate-limit.js';
import { MAX_WINDOW_RADIUS } from '../roads/summary-input.js';
import { openApiDocument } from './openapi.js';
import { roadSummaryPaths, roadSummaryTags } from './road-summary-openapi.js';

describe('street summaries documentation', () => {
  it('describes the two reads under the Streets tag, with no session', () => {
    expect(Object.keys(roadSummaryPaths).sort()).toEqual([
      '/api/road-segments/{id}/summary',
      '/api/roads/{id}/summary',
    ]);
    for (const path of Object.values(roadSummaryPaths)) {
      expect(Object.keys(path)).toEqual(['get']);
      expect(path.get.tags).toEqual(['Streets']);
      expect(path.get).not.toHaveProperty('security');
      expect(Object.keys(path.get.responses)).toEqual(
        expect.arrayContaining(['400', '404', '429']),
      );
    }
  });

  it('says the limits the backend applies', () => {
    expect(roadSummaryTags[0]!.description).toContain(
      `${SUMMARY_REQUESTS_PER_MINUTE} requests per minute`,
    );
    const radius = roadSummaryPaths['/api/road-segments/{id}/summary'].get.parameters[1] as {
      schema: { maximum: number };
    };
    expect(radius.schema.maximum).toBe(MAX_WINDOW_RADIUS);
  });

  it('is part of the main document and uses only schemas that exist', () => {
    expect(Object.keys(openApiDocument.paths)).toContain('/api/roads/{id}/summary');
    const text =
      JSON.stringify(roadSummaryPaths) + JSON.stringify(openApiDocument.components.schemas);
    const names = [...text.matchAll(/#\/components\/schemas\/(\w+)/g)].map((match) => match[1]!);
    const known = new Set(Object.keys(openApiDocument.components.schemas));
    expect(names.filter((name) => !known.has(name))).toEqual([]);
  });
});

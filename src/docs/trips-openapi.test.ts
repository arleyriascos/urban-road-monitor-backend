import { describe, expect, it } from 'vitest';
import { TRIP_REQUESTS_PER_MINUTE } from '../middlewares/rate-limit.js';
import { endTripSchema } from '../trips/trip-input.js';
import { openApiDocument } from './openapi.js';
import { tripPaths, tripSchemas, tripTags } from './trips-openapi.js';

describe('trips documentation', () => {
  it('describes the four operations under the Trips tag', () => {
    expect(Object.keys(tripPaths).sort()).toEqual(['/api/trips', '/api/trips/{id}']);
    expect(Object.keys(tripPaths['/api/trips']).sort()).toEqual(['get', 'post']);
    expect(Object.keys(tripPaths['/api/trips/{id}']).sort()).toEqual(['get', 'patch']);
    expect(tripTags.map((tag) => tag.name)).toEqual(['Trips']);
    for (const path of Object.values(tripPaths)) {
      for (const operation of Object.values(path)) {
        expect(operation.tags).toEqual(['Trips']);
        expect(operation.security).toEqual([{ sessionToken: [] }]);
      }
    }
  });

  it('is part of the main document', () => {
    expect(Object.keys(openApiDocument.paths)).toContain('/api/trips/{id}');
    expect(openApiDocument.components.schemas).toHaveProperty('StartedTrip');
    expect(openApiDocument.tags.map((tag) => tag.name)).toContain('Trips');
  });

  it('says the limit the backend applies', () => {
    expect(tripTags[0]!.description).toContain(`${TRIP_REQUESTS_PER_MINUTE} requests per minute`);
  });

  it('asks for the same fields the validation asks for when a trip ends', () => {
    const asked = Object.keys(endTripSchema.shape).sort();
    expect(Object.keys(tripSchemas.EndTripRequest.properties).sort()).toEqual(asked);
    expect(tripSchemas.EndTripRequest.required).toEqual(['framesAnalyzed', 'distanceM']);
  });

  it('answers 404 where a trip is looked up, and 409 where the model can differ', () => {
    expect(Object.keys(tripPaths['/api/trips/{id}'].get.responses)).toContain('404');
    expect(Object.keys(tripPaths['/api/trips/{id}'].patch.responses)).toContain('404');
    expect(Object.keys(tripPaths['/api/trips'].post.responses)).toContain('409');
  });

  it('uses only schemas that exist', () => {
    const text = JSON.stringify(tripPaths);
    const names = [...text.matchAll(/#\/components\/schemas\/(\w+)/g)].map((match) => match[1]!);
    const known = new Set(Object.keys(openApiDocument.components.schemas));
    expect(names.filter((name) => !known.has(name))).toEqual([]);
  });
});

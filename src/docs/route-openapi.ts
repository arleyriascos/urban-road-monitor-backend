/**
 * OpenAPI description of POST /api/routes, the endpoint the frontend uses to ask for a
 * route. It is spread into the main document (openapi.ts).
 */
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

const point = {
  type: 'object',
  properties: {
    latitude: { type: 'number', minimum: -90, maximum: 90, example: 1.2136 },
    longitude: { type: 'number', minimum: -180, maximum: 180, example: -77.2811 },
  },
  required: ['latitude', 'longitude'],
  additionalProperties: false,
};

export const routeTags = [
  {
    name: 'Routes',
    description:
      'Routes between two points of the map, computed by the AI service and kept in an ' +
      'LRU cache. At most 30 requests per minute and IP address.',
  },
];

export const routeSchemas = {
  RouteRequest: {
    type: 'object',
    properties: {
      origin: point,
      destination: point,
      criterion: {
        type: 'string',
        enum: ['shortest', 'balanced', 'avoid_potholes'],
        default: 'balanced',
        description:
          'shortest ignores potholes; balanced weighs them; avoid_potholes avoids them hard. ' +
          'Cost of a segment: length x (1 + k x damage), with k = 0, 1 or 3.',
      },
      algorithm: {
        type: 'string',
        enum: ['astar', 'dijkstra'],
        default: 'astar',
        description: 'Both give the same route; dijkstra explores more nodes (for comparing).',
      },
    },
    required: ['origin', 'destination'],
    additionalProperties: false,
  },
  RoutePoint: {
    type: 'object',
    description: 'The intersection a click was moved to, and how far it was.',
    properties: {
      nodeId: { type: 'integer', example: 1042 },
      latitude: { type: 'number', example: 1.2136 },
      longitude: { type: 'number', example: -77.2811 },
      distanceM: { type: 'number', example: 3.2 },
    },
  },
  RouteStep: {
    type: 'object',
    description: 'One segment of the route, as a GeoJSON LineString in travel order.',
    properties: {
      type: { type: 'string', enum: ['Feature'] },
      id: { type: 'integer', example: 1 },
      geometry: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['LineString'] },
          coordinates: {
            type: 'array',
            description: '[longitude, latitude] points, already in the direction of travel',
            items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
          },
        },
      },
      properties: {
        type: 'object',
        properties: {
          order: { type: 'integer', example: 1 },
          segmentId: { type: 'integer', example: 3381 },
          roadName: { type: ['string', 'null'], example: 'Calle 18' },
          reversed: {
            type: 'boolean',
            description: 'True if the segment is crossed against its stored drawing',
          },
          lengthM: { type: 'number', example: 104.35 },
          damageScore: { type: 'number', example: 0 },
          cost: { type: 'number', example: 104.35 },
        },
      },
    },
  },
  RouteAnswer: {
    type: 'object',
    properties: {
      criterion: { type: 'string', enum: ['shortest', 'balanced', 'avoid_potholes'] },
      algorithm: { type: 'string', enum: ['astar', 'dijkstra'] },
      fromCache: { type: 'boolean', description: 'True if the route came from the cache' },
      origin: { $ref: '#/components/schemas/RoutePoint' },
      destination: { $ref: '#/components/schemas/RoutePoint' },
      summary: {
        type: 'object',
        properties: {
          lengthM: { type: 'number', example: 697.58 },
          cost: { type: 'number', example: 731.2 },
          steps: { type: 'integer', example: 10 },
          exploredNodes: { type: 'integer', example: 17 },
          computationMs: { type: 'integer', example: 0 },
        },
      },
      route: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['FeatureCollection'] },
          features: { type: 'array', items: { $ref: '#/components/schemas/RouteStep' } },
        },
      },
    },
  },
};

export const routePaths = {
  '/api/routes': {
    post: {
      tags: ['Routes'],
      summary: 'Route between two points, ready to draw',
      description:
        'Both clicks are rounded to 4 decimals (about 11 m) and moved to the nearest ' +
        'intersection. The first time a route is asked for it may take up to a minute, if ' +
        'the AI service on Render was asleep; repeated routes come from the cache at once.',
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/RouteRequest' } },
        },
      },
      responses: {
        200: {
          description: 'The route',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/RouteAnswer' } },
          },
        },
        400: errorResponse('INVALID_REQUEST or INVALID_JSON: the body is not valid'),
        404: errorResponse('NO_ROUTE: one-way streets make the trip impossible'),
        422: errorResponse(
          'OUTSIDE_NETWORK: a click is too far from the streets; details says which and how far',
        ),
        429: errorResponse('TOO_MANY_REQUESTS: more than 30 requests in a minute; see Retry-After'),
        503: errorResponse(
          'ROUTE_SERVICE_UNAVAILABLE (details.retryable says if trying again can help) or ' +
            'DATABASE_UNAVAILABLE',
        ),
      },
    },
  },
};

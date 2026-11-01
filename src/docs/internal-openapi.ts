/**
 * OpenAPI description of the internal endpoints, which only the AI service calls.
 * It is spread into the main document (openapi.ts). The endpoint is public knowledge
 * (so is the repository); what protects it is the INTERNAL_TOKEN.
 */
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

export const internalTags = [
  {
    name: 'Internal',
    description:
      'Endpoints for the AI service only. They need "Authorization: Bearer <INTERNAL_TOKEN>"; ' +
      'without INTERNAL_TOKEN configured on the server they answer 404.',
  },
];

export const internalSecuritySchemes = {
  internalToken: {
    type: 'http',
    scheme: 'bearer',
    description: 'The INTERNAL_TOKEN shared by the backend and the AI service.',
  },
};

export const internalSchemas = {
  GraphNode: {
    type: 'object',
    description: 'An intersection (road_nodes) used by at least one segment.',
    properties: {
      id: { type: 'integer', example: 1042 },
      latitude: { type: 'number', example: 1.2136 },
      longitude: { type: 'number', example: -77.2811 },
    },
    required: ['id', 'latitude', 'longitude'],
  },
  GraphSegment: {
    type: 'object',
    description: 'A road segment (road_segments) as the route search needs it.',
    properties: {
      id: { type: 'integer', example: 3381 },
      fromNodeId: { type: 'integer', example: 1042 },
      toNodeId: { type: 'integer', example: 1043 },
      lengthM: { type: 'number', example: 104.35 },
      damageScore: {
        type: 'number',
        example: 2,
        description: 'Sum of severity weight x confidence of its active potholes.',
      },
      isOneway: {
        type: 'boolean',
        description: 'When true, traffic only goes from fromNodeId to toNodeId.',
      },
    },
    required: ['id', 'fromNodeId', 'toNodeId', 'lengthM', 'damageScore', 'isOneway'],
  },
  RoadGraph: {
    type: 'object',
    description:
      'The whole road graph, read from one consistent view of the database. ' +
      'Nodes and segments are ordered by id.',
    properties: {
      version: {
        type: 'string',
        example: '940ab0350236d4a94de0b11d6ed78931',
        description:
          'MD5 of the nodes and segments sent. It changes if and only if the graph data changes.',
      },
      nodes: { type: 'array', items: { $ref: '#/components/schemas/GraphNode' } },
      segments: { type: 'array', items: { $ref: '#/components/schemas/GraphSegment' } },
    },
    required: ['version', 'nodes', 'segments'],
  },
};

export const internalPaths = {
  '/internal/graph': {
    get: {
      tags: ['Internal'],
      summary: 'Road graph for the AI service',
      description:
        'Every segment and the nodes they use, with the version of the graph. ' +
        'The AI service downloads it again only when the version changes. ' +
        'Answered with "Cache-Control: no-store" and compressed when the client accepts it.',
      security: [{ internalToken: [] }],
      responses: {
        200: {
          description: 'The road graph',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/RoadGraph' } },
          },
        },
        401: errorResponse('The Authorization header is missing or the token is wrong'),
        404: errorResponse('INTERNAL_TOKEN is not configured on the server'),
        503: errorResponse('The database is not available'),
      },
    },
  },
};

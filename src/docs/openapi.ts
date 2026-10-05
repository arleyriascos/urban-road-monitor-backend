/**
 * OpenAPI 3.1 description of the API, rendered by Swagger UI at /api/docs.
 * Every new endpoint must be documented here when it is created.
 */
const errorSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'DATABASE_UNAVAILABLE' },
        message: { type: 'string', example: 'The database is not available right now' },
      },
      required: ['code', 'message'],
    },
  },
  required: ['error'],
};

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Urban Road Monitor API',
    version: '0.1.0',
    description:
      'REST API for automatic pothole detection and damage-aware route recommendation on the urban roads of Pasto, Colombia.',
  },
  servers: [{ url: '/', description: 'Current server' }],
  tags: [{ name: 'Health', description: 'Server and database status' }],
  paths: {
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'Server and database status',
        responses: {
          200: {
            description: 'The server is running and the database is reachable',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/HealthReport' } },
            },
          },
          503: {
            description: 'The server is running but cannot reach the database',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/HealthReport' } },
            },
          },
        },
      },
    },
    '/api/hello': {
      get: {
        tags: ['Health'],
        summary: 'Hello World served by the API with a database check',
        responses: {
          200: {
            description: 'Greeting plus data read from the database',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/HelloMessage' } },
            },
          },
          503: {
            description: 'The database is not available',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Error: errorSchema,
      HealthReport: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded'] },
          uptimeSeconds: { type: 'integer', example: 42 },
          database: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['connected', 'disconnected'] },
              latencyMs: { type: ['integer', 'null'], example: 35 },
            },
          },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      HelloMessage: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'Hello World' },
          project: { type: 'string', example: 'Urban Road Monitor' },
          database: {
            type: 'object',
            properties: {
              status: { type: 'string', example: 'connected' },
              name: { type: 'string', example: 'urban_road_monitor' },
              serverTime: { type: 'string', format: 'date-time' },
              latencyMs: { type: 'integer', example: 35 },
              severityLevels: {
                type: 'array',
                items: { type: 'string' },
                example: ['leve', 'moderado', 'grave'],
              },
            },
          },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
};

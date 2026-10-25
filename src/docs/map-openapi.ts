/**
 * OpenAPI description of the endpoints that feed the map. It is spread into the main
 * document (openapi.ts), which is what Swagger UI shows at /api/docs.
 */
const severityNames = ['sin baches', 'leve', 'moderado', 'grave'];

const lonLatPosition = {
  type: 'array',
  items: { type: 'number' },
  minItems: 2,
  maxItems: 2,
  description: 'GeoJSON position: [longitude, latitude].',
  example: [-77.2811, 1.2136],
};

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

export const mapTags = [
  {
    name: 'Map',
    description:
      'Streets and potholes drawn on the map. Public and read only (guests can use them).',
  },
];

export const mapSchemas = {
  SegmentProperties: {
    type: 'object',
    properties: {
      roadId: { type: 'integer', example: 120 },
      name: { type: ['string', 'null'], example: 'Calle 18' },
      roadType: { type: 'string', example: 'Calle residencial' },
      lengthM: { type: 'number', example: 104.35 },
      isOneway: {
        type: 'boolean',
        description: 'When true, traffic goes in the direction of the line (first to last point).',
      },
      damageScore: {
        type: 'number',
        description:
          'Sum of severity weight x confidence of the active potholes. Route cost = length x (1 + damageScore).',
        example: 4.5,
      },
      severity: {
        type: 'string',
        enum: severityNames,
        description: 'Worst severity of the segment.',
      },
      color: { type: 'string', example: '#DC2626', description: 'Color to draw the segment.' },
      activePotholes: { type: 'integer', example: 2 },
    },
    required: [
      'roadId',
      'name',
      'roadType',
      'lengthM',
      'isOneway',
      'damageScore',
      'severity',
      'color',
      'activePotholes',
    ],
  },
  SegmentFeature: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['Feature'] },
      id: { type: 'integer', description: 'Id of the road segment.' },
      geometry: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['LineString'] },
          coordinates: { type: 'array', items: lonLatPosition },
        },
        required: ['type', 'coordinates'],
      },
      properties: { $ref: '#/components/schemas/SegmentProperties' },
    },
    required: ['type', 'id', 'geometry', 'properties'],
  },
  SegmentCollection: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['FeatureCollection'] },
      features: { type: 'array', items: { $ref: '#/components/schemas/SegmentFeature' } },
    },
    required: ['type', 'features'],
  },
  PotholeProperties: {
    type: 'object',
    properties: {
      severity: { type: 'string', enum: ['leve', 'moderado', 'grave'] },
      color: { type: 'string', example: '#DC2626' },
      status: { type: 'string', enum: ['sin confirmar', 'confirmado', 'reparado'] },
      confidence: { type: 'number', minimum: 0, maximum: 1, example: 0.875 },
      detectionCount: { type: 'integer', example: 3 },
      segmentId: { type: ['integer', 'null'] },
      roadName: { type: ['string', 'null'], example: 'Carrera 25' },
      firstDetectedAt: { type: 'string', format: 'date-time' },
      lastDetectedAt: { type: 'string', format: 'date-time' },
    },
    required: [
      'severity',
      'color',
      'status',
      'confidence',
      'detectionCount',
      'segmentId',
      'roadName',
      'firstDetectedAt',
      'lastDetectedAt',
    ],
  },
  PotholeFeature: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['Feature'] },
      id: { type: 'string', format: 'uuid' },
      geometry: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['Point'] },
          coordinates: lonLatPosition,
        },
        required: ['type', 'coordinates'],
      },
      properties: { $ref: '#/components/schemas/PotholeProperties' },
    },
    required: ['type', 'id', 'geometry', 'properties'],
  },
  PotholeCollection: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['FeatureCollection'] },
      features: { type: 'array', items: { $ref: '#/components/schemas/PotholeFeature' } },
    },
    required: ['type', 'features'],
  },
  NetworkStats: {
    type: 'object',
    properties: {
      roads: { type: 'integer', example: 4610 },
      segments: { type: 'integer', example: 10134 },
      totalLengthKm: { type: 'number', example: 774.1 },
      segmentsBySeverity: {
        type: 'array',
        description: 'Legend of the map, from no potholes to the worst severity.',
        items: {
          type: 'object',
          properties: {
            severity: { type: 'string', enum: severityNames },
            color: { type: 'string', example: '#22C55E' },
            count: { type: 'integer' },
          },
          required: ['severity', 'color', 'count'],
        },
      },
      potholesByStatus: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['sin confirmar', 'confirmado', 'reparado'] },
            count: { type: 'integer' },
          },
          required: ['status', 'count'],
        },
      },
      lastPotholeDetectedAt: { type: ['string', 'null'], format: 'date-time' },
    },
    required: [
      'roads',
      'segments',
      'totalLengthKm',
      'segmentsBySeverity',
      'potholesByStatus',
      'lastPotholeDetectedAt',
    ],
  },
};

export const mapPaths = {
  '/api/road-segments': {
    get: {
      tags: ['Map'],
      summary: 'All road segments, colored by pothole severity',
      description:
        'GeoJSON FeatureCollection of LineStrings. The whole city is returned at once (several ' +
        'megabytes of JSON, compressed with gzip). Supports ETag: send If-None-Match to get a 304.',
      responses: {
        200: {
          description: 'The road network with the state of every segment',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SegmentCollection' } },
          },
        },
        500: errorResponse('Unexpected error (for example, the database failed)'),
      },
    },
  },
  '/api/potholes': {
    get: {
      tags: ['Map'],
      summary: 'Consolidated potholes, as points',
      description:
        'GeoJSON FeatureCollection of Points. Repaired potholes are left out by default.',
      parameters: [
        {
          name: 'includeRepaired',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['true', 'false'], default: 'false' },
          description: 'Use true to include potholes with status "reparado".',
        },
      ],
      responses: {
        200: {
          description: 'The potholes',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/PotholeCollection' } },
          },
        },
        400: errorResponse('includeRepaired is not true or false'),
        500: errorResponse('Unexpected error (for example, the database failed)'),
      },
    },
  },
  '/api/road-network/stats': {
    get: {
      tags: ['Map'],
      summary: 'Numbers for the legend and the header of the map',
      responses: {
        200: {
          description: 'Totals of the road network and the potholes',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/NetworkStats' } },
          },
        },
        500: errorResponse('Unexpected error (for example, the database failed)'),
      },
    },
  },
};

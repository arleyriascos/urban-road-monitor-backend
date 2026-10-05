import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from '../docs/openapi.js';

export const docsRouter = Router();

// Raw OpenAPI document (useful for tools such as Postman).
docsRouter.get('/docs.json', (_req, res) => {
  res.status(200).json(openApiDocument);
});

// Interactive documentation.
docsRouter.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

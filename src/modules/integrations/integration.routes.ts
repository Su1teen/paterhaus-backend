import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createMapping,
  createMappingSchema,
  getIntegrationHealth,
  getWebhookEvent,
  listMappings,
  listWebhookEvents,
  mappingIdParamSchema,
  updateMapping,
  updateMappingSchema,
  webhookEventIdParamSchema,
  webhookEventListQuerySchema,
} from './integration.service.js';

const integrationTag = { tags: ['integrations'] } as const;

const mappingListQuerySchema = z.object({
  provider: z.string().trim().min(1).max(120).optional(),
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/integrations/health',
    {
      schema: {
        ...integrationTag,
        summary: 'Conservative integration health report',
        description:
          'Reports API and database state plus connector activity inferred from received webhook events. ' +
          'External systems without a real connection check are reported as `not_configured`.',
      },
    },
    async () => getIntegrationHealth(),
  );

  app.get(
    '/integrations/webhook-events',
    {
      schema: {
        ...integrationTag,
        summary: 'List stored webhook events (newest first)',
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['RECEIVED', 'PROCESSED', 'DUPLICATE', 'NEEDS_REVIEW', 'FAILED'] },
            provider: { type: 'string' },
            dateFrom: { type: 'string', format: 'date-time' },
            dateTo: { type: 'string', format: 'date-time' },
            page: { type: 'integer', minimum: 1 },
            limit: { type: 'integer', minimum: 1, description: 'Page size; clamped to a maximum of 100' },
          },
        },
      },
    },
    async (request) => listWebhookEvents(webhookEventListQuerySchema.parse(request.query)),
  );

  app.get(
    '/integrations/webhook-events/:id',
    { schema: { ...integrationTag, summary: 'Get a stored webhook event with its raw payload' } },
    async (request) => {
      const { id } = webhookEventIdParamSchema.parse(request.params);
      return getWebhookEvent(id);
    },
  );

  app.get(
    '/integrations/mappings',
    {
      schema: {
        ...integrationTag,
        summary: 'List integration mappings',
        querystring: {
          type: 'object',
          properties: {
            provider: { type: 'string' },
            active: { type: 'string', enum: ['true', 'false'] },
          },
        },
      },
    },
    async (request) => {
      const query = mappingListQuerySchema.parse(request.query);
      return listMappings(query.provider, query.active);
    },
  );

  app.post(
    '/integrations/mappings',
    {
      schema: {
        ...integrationTag,
        summary: 'Create an integration mapping',
        body: {
          type: 'object',
          required: ['provider', 'sourceField', 'sourceValue', 'targetField', 'targetValue'],
          properties: {
            provider: { type: 'string', example: 'paterhaus_meta_connector' },
            sourceField: { type: 'string', example: 'service' },
            sourceValue: { type: 'string', example: 'Property Management' },
            targetField: { type: 'string', example: 'direction' },
            targetValue: { type: 'string', example: 'PROPERTY_MANAGEMENT' },
            active: { type: 'boolean', example: true },
          },
        },
      },
    },
    async (request, reply) => {
      const input = createMappingSchema.parse(request.body);
      const mapping = await createMapping(input);
      return reply.status(201).send(mapping);
    },
  );

  app.patch(
    '/integrations/mappings/:id',
    {
      schema: {
        ...integrationTag,
        summary: 'Update an integration mapping',
        body: { type: 'object', additionalProperties: true },
      },
    },
    async (request) => {
      const { id } = mappingIdParamSchema.parse(request.params);
      const input = updateMappingSchema.parse(request.body);
      return updateMapping(id, input);
    },
  );
}

import type { FastifyInstance } from 'fastify';
import {
  createLeadSchema,
  leadIdParamSchema,
  leadListQuerySchema,
  updateLeadSchema,
} from './lead.schemas.js';
import { createLead, deleteLead, getLead, listLeads, updateLead } from './lead.service.js';

const leadTag = { tags: ['leads'] } as const;

export async function leadRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/leads',
    {
      schema: {
        ...leadTag,
        summary: 'List leads',
        querystring: {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['UNCLASSIFIED', 'PROPERTY_MANAGEMENT', 'SNAGGING', 'STAGING'] },
            stage: { type: 'string' },
            source: {
              type: 'string',
              enum: ['META_CONNECTOR', 'META_LEAD_ADS', 'WHATSAPP', 'WEBSITE', 'REFERRAL', 'MANUAL', 'OTHER'],
            },
            mappingStatus: { type: 'string', enum: ['MAPPED', 'NEEDS_REVIEW', 'FAILED'] },
            campaignId: { type: 'string', format: 'uuid' },
            search: { type: 'string' },
            page: { type: 'integer', minimum: 1 },
            limit: { type: 'integer', minimum: 1, description: 'Page size; clamped to a maximum of 100' },
          },
        },
      },
    },
    async (request) => listLeads(leadListQuerySchema.parse(request.query)),
  );

  app.get(
    '/leads/:id',
    { schema: { ...leadTag, summary: 'Get a lead by id' } },
    async (request) => {
      const { id } = leadIdParamSchema.parse(request.params);
      return getLead(id);
    },
  );

  app.post(
    '/leads',
    {
      schema: {
        ...leadTag,
        summary: 'Create a lead',
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'Ivan Ivanov' },
            phone: { type: 'string', example: '+77001234567' },
            email: { type: 'string', example: 'ivan@example.com' },
            propertyType: { type: 'string', example: 'Apartment' },
            serviceRaw: { type: 'string', example: 'Snagging' },
            direction: { type: 'string', enum: ['UNCLASSIFIED', 'PROPERTY_MANAGEMENT', 'SNAGGING', 'STAGING'] },
            stage: { type: 'string', example: 'new' },
            source: {
              type: 'string',
              enum: ['META_CONNECTOR', 'META_LEAD_ADS', 'WHATSAPP', 'WEBSITE', 'REFERRAL', 'MANUAL', 'OTHER'],
            },
            campaignId: { type: 'string', format: 'uuid' },
            assignedUserId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request, reply) => {
      const input = createLeadSchema.parse(request.body);
      const lead = await createLead(input);
      return reply.status(201).send(lead);
    },
  );

  app.patch(
    '/leads/:id',
    { schema: { ...leadTag, summary: 'Update a lead', body: { type: 'object', additionalProperties: true } } },
    async (request) => {
      const { id } = leadIdParamSchema.parse(request.params);
      const input = updateLeadSchema.parse(request.body);
      return updateLead(id, input);
    },
  );

  app.delete(
    '/leads/:id',
    { schema: { ...leadTag, summary: 'Delete a lead' } },
    async (request, reply) => {
      const { id } = leadIdParamSchema.parse(request.params);
      await deleteLead(id);
      return reply.status(204).send();
    },
  );
}

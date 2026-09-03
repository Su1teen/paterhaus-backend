import type { FastifyInstance } from 'fastify';
import { requireConversationAccess } from '../conversations/conversation.auth.js';
import { LeadClassificationRepository } from './lead-classification.repository.js';
import {
  LEAD_PROPERTY_TYPES,
  LEAD_SERVICES,
  leadClassificationListQuerySchema,
  manualLeadRequestSchema,
} from './lead-classification.schemas.js';
import { LeadClassificationService } from './lead-classification.service.js';

export interface LeadClassificationRouteOptions {
  repository?: LeadClassificationRepository;
}

export async function leadClassificationRoutes(
  app: FastifyInstance,
  options: LeadClassificationRouteOptions,
): Promise<void> {
  const service = new LeadClassificationService(options.repository);

  app.get(
    '/api/paterhaus/lead-classifications',
    {
      preHandler: requireConversationAccess,
      schema: {
        tags: ['paterhaus-conversations'],
        summary: 'List AI lead classifications for the Owner Pipeline',
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
            cursor: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async (request) => service.list(leadClassificationListQuerySchema.parse(request.query)),
  );

  app.post(
    '/api/paterhaus/leads/manual',
    {
      preHandler: requireConversationAccess,
      schema: {
        tags: ['paterhaus-conversations'],
        summary: 'Create or update a manual lead in pater_classification (allowlisted CRM accounts only)',
        body: {
          type: 'object',
          required: ['phoneNumber', 'propertyType', 'service'],
          additionalProperties: false,
          properties: {
            name: { type: ['string', 'null'], maxLength: 200 },
            phoneNumber: { type: 'string', minLength: 1, maxLength: 40 },
            email: { type: ['string', 'null'], maxLength: 254 },
            propertyType: { type: 'string', enum: [...LEAD_PROPERTY_TYPES] },
            service: { type: 'string', enum: [...LEAD_SERVICES] },
          },
        },
      },
    },
    async (request, reply) => {
      const input = manualLeadRequestSchema.parse(request.body);
      const result = await service.createManual(input, request.conversationAccessEmail ?? '');
      return reply.status(result.created ? 201 : 200).send(result.lead);
    },
  );
}

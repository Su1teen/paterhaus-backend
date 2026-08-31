import type { FastifyInstance } from 'fastify';
import { requireConversationAccess } from '../conversations/conversation.auth.js';
import { LeadClassificationRepository } from './lead-classification.repository.js';
import { leadClassificationListQuerySchema } from './lead-classification.schemas.js';
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
}

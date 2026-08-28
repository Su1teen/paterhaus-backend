import type { FastifyInstance } from 'fastify';
import {
  issueConversationAccessToken,
  requireConversationAccess,
} from './conversation.auth.js';
import { ConversationRepository } from './conversation.repository.js';
import {
  accessTokenRequestSchema,
  conversationIdParamSchema,
  conversationListQuerySchema,
  updateConversationAiSchema,
} from './conversation.schemas.js';
import { ConversationService } from './conversation.service.js';

export interface ConversationRouteOptions {
  repository?: ConversationRepository;
}

const conversationTag = { tags: ['paterhaus-conversations'] } as const;

export async function conversationRoutes(
  app: FastifyInstance,
  options: ConversationRouteOptions,
): Promise<void> {
  const service = new ConversationService(options.repository);

  // Temporary bridge while CRM login is frontend-local; replace with verified server sessions.
  app.post(
    '/api/paterhaus/conversations/access-token',
    {
      schema: {
        ...conversationTag,
        summary: 'Issue a short-lived live-conversations access token',
        body: {
          type: 'object',
          required: ['email'],
          additionalProperties: false,
          properties: { email: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request) => issueConversationAccessToken(accessTokenRequestSchema.parse(request.body).email),
  );

  app.get(
    '/api/paterhaus/conversations',
    {
      preHandler: requireConversationAccess,
      schema: {
        ...conversationTag,
        summary: 'List live Paterhaus conversations',
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            cursor: { type: 'integer', minimum: 0 },
            search: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (request) => service.list(conversationListQuerySchema.parse(request.query)),
  );

  app.get(
    '/api/paterhaus/conversations/:conversationId/messages',
    {
      preHandler: requireConversationAccess,
      schema: { ...conversationTag, summary: 'Get a live conversation message history' },
    },
    async (request) => {
      const { conversationId } = conversationIdParamSchema.parse(request.params);
      return service.getMessages(conversationId);
    },
  );

  app.patch(
    '/api/paterhaus/conversations/:conversationId/ai',
    {
      preHandler: requireConversationAccess,
      schema: {
        ...conversationTag,
        summary: 'Enable or disable AI for one live conversation',
        body: {
          type: 'object',
          required: ['aiEnabled'],
          additionalProperties: false,
          properties: { aiEnabled: { type: 'boolean' } },
        },
      },
    },
    async (request) => {
      const { conversationId } = conversationIdParamSchema.parse(request.params);
      const { aiEnabled } = updateConversationAiSchema.parse(request.body);
      const result = await service.setAiEnabled(conversationId, aiEnabled);
      request.log.info(
        { conversationId, aiEnabled, authorizedEmail: request.conversationAccessEmail },
        'Conversation AI state updated',
      );
      return result;
    },
  );
}

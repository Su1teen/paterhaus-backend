import type { FastifyInstance } from 'fastify';
import {
  issueConversationAccessToken,
  requireConversationAccess,
} from './conversation.auth.js';
import { ConversationRepository } from './conversation.repository.js';
import {
  MAX_MANUAL_MESSAGE_LENGTH,
  accessTokenRequestSchema,
  conversationIdParamSchema,
  conversationListQuerySchema,
  sendConversationMessageSchema,
  updateConversationAiSchema,
} from './conversation.schemas.js';
import {
  createOutboundMessageSender,
  type OutboundMessageSender,
} from './conversation.outbound.js';
import { ConversationService } from './conversation.service.js';
import { randomUUID } from 'node:crypto';

export interface ConversationRouteOptions {
  repository?: ConversationRepository;
  /** `null` disables manual replies; omit to derive the sender from the environment. */
  outboundSender?: OutboundMessageSender | null;
}

const conversationTag = { tags: ['paterhaus-conversations'] } as const;

export async function conversationRoutes(
  app: FastifyInstance,
  options: ConversationRouteOptions,
): Promise<void> {
  const outboundSender =
    options.outboundSender === undefined ? createOutboundMessageSender() : options.outboundSender;
  const service = new ConversationService(options.repository, outboundSender);

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
    '/api/paterhaus/conversations/capabilities',
    {
      preHandler: requireConversationAccess,
      schema: {
        ...conversationTag,
        summary: 'Report which live-conversation write features this deployment supports',
      },
    },
    async () => ({
      manualMessages: service.manualRepliesSupported,
      // No upload path exists through the backend/n8n/WAHA chain yet.
      attachments: false,
      maxMessageLength: MAX_MANUAL_MESSAGE_LENGTH,
    }),
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

  app.post(
    '/api/paterhaus/conversations/:conversationId/messages',
    {
      preHandler: requireConversationAccess,
      schema: {
        ...conversationTag,
        summary: 'Send a human takeover reply through the protected outbound integration',
        body: {
          type: 'object',
          required: ['text'],
          additionalProperties: false,
          properties: {
            text: { type: 'string', minLength: 1, maxLength: MAX_MANUAL_MESSAGE_LENGTH },
            idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 },
          },
        },
      },
    },
    async (request, reply) => {
      const { conversationId } = conversationIdParamSchema.parse(request.params);
      const { text, idempotencyKey } = sendConversationMessageSchema.parse(request.body);
      const headerKey = request.headers['idempotency-key'];

      const result = await service.sendHumanMessage({
        conversationId,
        text,
        authorizedEmail: request.conversationAccessEmail ?? '',
        idempotencyKey:
          idempotencyKey ?? (typeof headerKey === 'string' ? headerKey : null) ?? randomUUID(),
      });

      request.log.info(
        { conversationId, authorizedEmail: request.conversationAccessEmail },
        'Human takeover reply delivered',
      );
      return reply.status(201).send(result);
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

import type { FastifyInstance } from 'fastify';
import { getEnv } from '../../config/env.js';
import { badRequest, unauthorized } from '../../plugins/error-handler.js';
import { isValidWebhookAuth, redactHeaders } from '../../utils/webhook-auth.js';
import { SAMPLE_WEBHOOK_PAYLOAD, metaLeadPayloadSchema, webhookResponseSchema } from './webhook.schemas.js';
import { processMetaLeadWebhook } from './webhook.service.js';

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/webhooks/meta-leads',
    {
      schema: {
        tags: ['webhooks'],
        summary: 'Paterhaus Meta connector lead intake',
        description:
          'Permanent intake endpoint for the Paterhaus custom Meta/Zapier connector. Requires ' +
          '`Authorization: Bearer <WEBHOOK_SECRET>`. Unknown fields are preserved in the stored raw payload.',
        security: [{ webhookBearer: [] }],
        body: {
          type: 'object',
          additionalProperties: true,
          example: SAMPLE_WEBHOOK_PAYLOAD,
        },
        response: {
          200: webhookResponseSchema,
          400: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
          401: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
        },
      },
    },
    async (request, reply) => {
      const { WEBHOOK_SECRET } = getEnv();

      if (!isValidWebhookAuth(request.headers.authorization, WEBHOOK_SECRET)) {
        throw unauthorized('Invalid or missing webhook credentials');
      }

      const body = request.body;
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw badRequest('Request body must be a JSON object');
      }

      const parsed = metaLeadPayloadSchema.safeParse(body);
      if (!parsed.success) {
        throw badRequest('Request body must be a JSON object');
      }

      const safeHeaders = redactHeaders(request.headers as Record<string, unknown>);
      const result = await processMetaLeadWebhook(parsed.data, safeHeaders);

      request.log.info(
        { webhookEventId: result.eventId, status: result.status },
        'Processed inbound connector webhook',
      );

      return reply.status(200).send({
        received: true,
        eventId: result.eventId,
        leadId: result.leadId,
        status: result.status,
      });
    },
  );
}

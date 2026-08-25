import type { FastifyInstance } from 'fastify';
import { getEnv } from '../../config/env.js';
import { badRequest, unauthorized } from '../../plugins/error-handler.js';
import { isValidWebhookAuth, redactHeaders, safeCompare } from '../../utils/webhook-auth.js';
import { SAMPLE_WEBHOOK_PAYLOAD, metaLeadPayloadSchema, webhookResponseSchema } from './webhook.schemas.js';
import { persistConnectorGetEvent, processMetaLeadWebhook } from './webhook.service.js';

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

  // Legacy GET ingestion adapter for third-party lead connectors that can only
  // issue HTTP GET and cannot send a Bearer header. The connector token is
  // supplied via `?key=<CONNECTOR_WEBHOOK_TOKEN>`. The remaining query
  // parameters are persisted verbatim as a WebhookEvent for inspection only —
  // no lead is created and no downstream side effects run.
  app.get(
    '/webhooks/meta-leads',
    {
      schema: {
        tags: ['webhooks'],
        summary: 'Legacy GET ingestion adapter for token-only lead connectors',
        description:
          'Compatibility endpoint for third-party lead connectors that can only issue HTTP GET and ' +
          'cannot send custom headers. Authenticate with `?key=<CONNECTOR_WEBHOOK_TOKEN>`. All other ' +
          'query parameters are stored as a WebhookEvent for inspection only — no lead is created. ' +
          'Prefer POST /webhooks/meta-leads with a Bearer secret whenever possible. ' +
          'WARNING: query-string tokens and PII may appear in third-party/proxy logs; use this mode ' +
          'only for legacy connector compatibility.',
        querystring: {
          type: 'object',
          additionalProperties: true,
          properties: {
            key: { type: 'string', description: 'Connector authentication token' },
          },
        },
        response: {
          200: { type: 'object', properties: { ok: { type: 'boolean' } } },
          401: {
            type: 'object',
            properties: { ok: { type: 'boolean' }, error: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const { CONNECTOR_WEBHOOK_TOKEN } = getEnv();
      const query = request.query as Record<string, unknown>;
      const providedKey = query.key;

      if (
        typeof providedKey !== 'string' ||
        providedKey.length === 0 ||
        !CONNECTOR_WEBHOOK_TOKEN ||
        !safeCompare(providedKey, CONNECTOR_WEBHOOK_TOKEN)
      ) {
        request.log.info({ source: 'connector-get' }, 'Rejected connector GET webhook');
        return reply.status(401).send({ ok: false, error: 'Unauthorized' });
      }

      // Build the raw payload from every query parameter except `key`,
      // preserving repeated parameters as arrays (Fastify's default parser
      // already exposes them as arrays).
      const payload: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(query)) {
        if (name === 'key') continue;
        payload[name] = value;
      }

      const safeHeaders = redactHeaders(request.headers as Record<string, unknown>);
      safeHeaders['x-request-method'] = 'GET';
      const result = await persistConnectorGetEvent(payload, safeHeaders);

      request.log.info(
        { webhookEventId: result.eventId, source: 'connector-get' },
        'Persisted connector GET webhook',
      );

      return reply.status(200).send({ ok: true });
    },
  );
}

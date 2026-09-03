import Fastify, { type FastifyInstance } from 'fastify';
import { getEnv } from './config/env.js';
import { closeChatHistoryPool } from './lib/chat-history-db.js';
import { calendarRoutes } from './modules/calendar/calendar.routes.js';
import { campaignRoutes } from './modules/campaigns/campaign.routes.js';
import {
  conversationRoutes,
  type ConversationRouteOptions,
} from './modules/conversations/conversation.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { integrationRoutes } from './modules/integrations/integration.routes.js';
import { internalMonitorRoutes } from './modules/internal/monitor.routes.js';
import {
  leadClassificationRoutes,
  type LeadClassificationRouteOptions,
} from './modules/lead-classifications/lead-classification.routes.js';
import { leadRoutes } from './modules/leads/lead.routes.js';
import { webhookRoutes } from './modules/webhooks/webhook.routes.js';
import { registerCors } from './plugins/cors.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerSwagger } from './plugins/swagger.js';

const REDACTED_QUERY_PARAMS = new Set(['token', 'secret', 'access_token', 'key']);

/** Removes credential-bearing query parameters so request URLs are safe to log. */
function sanitizeUrl(url: string | undefined): string {
  if (!url) return '';

  const [path, query] = url.split('?');
  if (!query) return url;

  // Webhook routes may carry tokens and PII (name, phone, email) in the query
  // string (legacy GET connector adapter). Log the pathname only — never the
  // query string — for these routes.
  if (path?.startsWith('/webhooks/')) return path ?? '';

  const params = new URLSearchParams(query);
  for (const key of params.keys()) {
    if (REDACTED_QUERY_PARAMS.has(key.toLowerCase())) params.set(key, '[redacted]');
  }

  const serialized = params.toString();
  return serialized.length > 0 ? `${path}?${serialized}` : (path ?? '');
}

export interface BuildAppOptions {
  conversations?: ConversationRouteOptions;
  leadClassifications?: LeadClassificationRouteOptions;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = getEnv();

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Request/response logs must never carry payloads, secrets or auth headers.
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body', 'res.body'],
        remove: true,
      },
      serializers: {
        req: (request) => ({ method: request.method, url: sanitizeUrl(request.url) }),
      },
    },
    // `example` is OpenAPI metadata, not a JSON Schema validation keyword.
    ajv: { customOptions: { keywords: ['example'] } },
    disableRequestLogging: false,
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  registerErrorHandler(app);

  await registerCors(app);
  await registerSwagger(app);

  await app.register(healthRoutes);
  await app.register(webhookRoutes);
  await app.register(leadRoutes);
  await app.register(campaignRoutes);
  await app.register(conversationRoutes, options.conversations ?? {});
  await app.register(leadClassificationRoutes, options.leadClassifications ?? {});
  await app.register(calendarRoutes);
  await app.register(integrationRoutes);
  await app.register(internalMonitorRoutes);

  app.addHook('onClose', closeChatHistoryPool);

  return app;
}

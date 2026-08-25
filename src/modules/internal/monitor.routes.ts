import { WebhookEventStatus } from '@prisma/client';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getEnv } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { isValidDashboardToken } from '../../utils/dashboard-auth.js';
import {
  getConnectorState,
  getWebhookEvent,
  listWebhookEvents,
} from '../integrations/integration.service.js';
import { renderMonitorDetail, renderMonitorList } from './monitor.view.js';

const monitorQuerySchema = z.object({
  token: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  // Oversized limits are clamped by resolvePagination rather than rejected.
  limit: z.coerce.number().int().positive().optional(),
  status: z.nativeEnum(WebhookEventStatus).optional(),
  provider: z.string().trim().min(1).max(120).optional(),
});

function applySafetyHeaders(reply: FastifyReply): void {
  reply.header('X-Robots-Tag', 'noindex, nofollow');
  reply.header('Cache-Control', 'no-store');
  reply.header('Referrer-Policy', 'no-referrer');
}

function denyHtml(reply: FastifyReply): FastifyReply {
  applySafetyHeaders(reply);
  return reply
    .status(401)
    .type('text/html; charset=utf-8')
    .send(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow">' +
        '<title>Unauthorized</title></head><body style="font-family:sans-serif;background:#0c0d10;color:#e6e7ea;padding:32px">' +
        '<h1 style="font-size:18px">401 Unauthorized</h1><p>A valid access token is required.</p></body></html>',
    );
}

/**
 * Temporary internal diagnostic pages. Access is gated by INTERNAL_DASHBOARD_SECRET
 * passed as `?token=`; these routes are excluded from the public API docs.
 */
export async function internalMonitorRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/internal/webhook-monitor',
    { schema: { hide: true } },
    async (request, reply) => {
      const { INTERNAL_DASHBOARD_SECRET } = getEnv();
      const query = monitorQuerySchema.safeParse(request.query);

      if (!query.success || !isValidDashboardToken(query.data.token, INTERNAL_DASHBOARD_SECRET)) {
        return denyHtml(reply);
      }

      const token = query.data.token as string;
      const [{ data, meta }, connector, databaseConnected] = await Promise.all([
        listWebhookEvents({
          page: query.data.page,
          limit: query.data.limit,
          status: query.data.status,
          provider: query.data.provider,
        }),
        getConnectorState(),
        prisma
          .$queryRaw`SELECT 1`.then(() => true)
          .catch(() => false),
      ]);

      applySafetyHeaders(reply);
      return reply.type('text/html; charset=utf-8').send(
        renderMonitorList({
          token,
          connector,
          databaseConnected,
          events: data,
          page: meta.page,
          limit: meta.limit,
          total: meta.total,
          totalPages: meta.totalPages,
          status: query.data.status,
          provider: query.data.provider,
        }),
      );
    },
  );

  app.get(
    '/internal/webhook-monitor/events/:id',
    { schema: { hide: true } },
    async (request, reply) => {
      const { INTERNAL_DASHBOARD_SECRET } = getEnv();
      const query = monitorQuerySchema.safeParse(request.query);
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);

      if (!query.success || !isValidDashboardToken(query.data.token, INTERNAL_DASHBOARD_SECRET)) {
        return denyHtml(reply);
      }

      applySafetyHeaders(reply);

      if (!params.success) {
        return reply.status(404).type('text/html; charset=utf-8').send('<h1>404 Not Found</h1>');
      }

      const event = await getWebhookEvent(params.data.id);

      return reply.type('text/html; charset=utf-8').send(
        renderMonitorDetail({
          token: query.data.token as string,
          event: {
            id: event.id,
            provider: event.provider,
            status: event.status,
            receivedAt: event.receivedAt,
            processedAt: event.processedAt,
            errorMessage: event.errorMessage,
            payload: event.payload,
            lead: event.lead
              ? {
                  id: event.lead.id,
                  name: event.lead.name,
                  phone: event.lead.phone,
                  email: event.lead.email,
                  propertyType: event.lead.propertyType,
                  serviceRaw: event.lead.serviceRaw,
                  direction: event.lead.direction,
                  mappingStatus: event.lead.mappingStatus,
                }
              : null,
          },
        }),
      );
    },
  );
}

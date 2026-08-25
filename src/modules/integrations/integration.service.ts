import { Prisma, WebhookEventStatus, type WebhookEvent } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { notFound } from '../../plugins/error-handler.js';
import { buildMeta, resolvePagination, type PaginatedMeta } from '../../utils/pagination.js';
import { META_CONNECTOR_PROVIDER } from '../webhooks/webhook.service.js';

export const webhookEventListQuerySchema = z.object({
  status: z.nativeEnum(WebhookEventStatus).optional(),
  provider: z.string().trim().min(1).max(120).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export type WebhookEventListQuery = z.infer<typeof webhookEventListQuerySchema>;

export const createMappingSchema = z.object({
  provider: z.string().trim().min(1).max(120),
  sourceField: z.string().trim().min(1).max(120),
  sourceValue: z.string().trim().min(1).max(200),
  targetField: z.string().trim().min(1).max(120),
  targetValue: z.string().trim().min(1).max(200),
  active: z.boolean().default(true),
});

export const updateMappingSchema = z
  .object({
    provider: z.string().trim().min(1).max(120).optional(),
    sourceField: z.string().trim().min(1).max(120).optional(),
    sourceValue: z.string().trim().min(1).max(200).optional(),
    targetField: z.string().trim().min(1).max(120).optional(),
    targetValue: z.string().trim().min(1).max(200).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field must be provided' });

export const mappingIdParamSchema = z.object({ id: z.string().uuid() });
export const webhookEventIdParamSchema = z.object({ id: z.string().uuid() });

/**
 * A webhook event as exposed by the API: stored raw payload is allowed,
 * persisted request headers are never returned.
 */
export type WebhookEventDto = Omit<WebhookEvent, 'headers'>;

function toWebhookEventDto(event: WebhookEvent): WebhookEventDto {
  const { headers: _headers, ...rest } = event;
  return rest;
}

function buildWebhookEventWhere(query: WebhookEventListQuery): Prisma.WebhookEventWhereInput {
  const where: Prisma.WebhookEventWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.provider) where.provider = query.provider;
  if (query.dateFrom || query.dateTo) {
    where.receivedAt = {
      ...(query.dateFrom ? { gte: query.dateFrom } : {}),
      ...(query.dateTo ? { lte: query.dateTo } : {}),
    };
  }
  return where;
}

export interface WebhookEventListRow extends WebhookEventDto {
  lead: {
    id: string;
    name: string | null;
    serviceRaw: string | null;
    direction: string;
    mappingStatus: string;
  } | null;
}

export async function listWebhookEvents(
  query: WebhookEventListQuery,
): Promise<{ data: WebhookEventListRow[]; meta: PaginatedMeta }> {
  const pagination = resolvePagination(query);
  const where = buildWebhookEventWhere(query);

  const [events, total] = await Promise.all([
    prisma.webhookEvent.findMany({
      where,
      // `receivedAt` alone is unstable when several events share the same
      // millisecond (e.g. a GET connector delivery and a POST webhook landing
      // together). Sort by `createdAt` as a deterministic tiebreaker so the
      // monitor is always newest-first regardless of provider.
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
      skip: pagination.skip,
      take: pagination.take,
      include: {
        lead: { select: { id: true, name: true, serviceRaw: true, direction: true, mappingStatus: true } },
      },
    }),
    prisma.webhookEvent.count({ where }),
  ]);

  const data = events.map(({ lead, ...event }) => ({ ...toWebhookEventDto(event), lead }));

  return { data, meta: buildMeta(pagination, total) };
}

export async function getWebhookEvent(id: string) {
  const event = await prisma.webhookEvent.findUnique({
    where: { id },
    include: {
      lead: {
        select: {
          id: true,
          name: true,
          phone: true,
          normalizedPhone: true,
          email: true,
          normalizedEmail: true,
          propertyType: true,
          serviceRaw: true,
          direction: true,
          mappingStatus: true,
          stage: true,
          createdAt: true,
        },
      },
    },
  });

  if (!event) throw notFound('Webhook event not found');

  const { lead, ...rest } = event;
  return { ...toWebhookEventDto(rest), lead };
}

export async function listMappings(provider?: string, active?: boolean) {
  return prisma.integrationMapping.findMany({
    where: {
      ...(provider ? { provider } : {}),
      ...(active === undefined ? {} : { active }),
    },
    orderBy: [{ provider: 'asc' }, { sourceValue: 'asc' }],
  });
}

export async function createMapping(input: z.infer<typeof createMappingSchema>) {
  return prisma.integrationMapping.create({ data: input });
}

export async function updateMapping(id: string, input: z.infer<typeof updateMappingSchema>) {
  const existing = await prisma.integrationMapping.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound('Integration mapping not found');

  return prisma.integrationMapping.update({ where: { id }, data: input });
}

export type ConnectorStatus = 'no_events_yet' | 'receiving_events' | 'needs_review' | 'failing';

export interface ConnectorState {
  status: ConnectorStatus;
  lastEventAt: Date | null;
  eventsLast24h: number;
  needsReviewLast24h: number;
  failedLast24h: number;
}

/**
 * Connector activity is inferred only from received webhook events —
 * the backend has no live Meta connection to check.
 */
export async function getConnectorState(provider = META_CONNECTOR_PROVIDER): Promise<ConnectorState> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [lastEvent, eventsLast24h, needsReviewLast24h, failedLast24h] = await Promise.all([
    prisma.webhookEvent.findFirst({ where: { provider }, orderBy: { receivedAt: 'desc' } }),
    prisma.webhookEvent.count({ where: { provider, receivedAt: { gte: since } } }),
    prisma.webhookEvent.count({
      where: { provider, receivedAt: { gte: since }, status: WebhookEventStatus.NEEDS_REVIEW },
    }),
    prisma.webhookEvent.count({
      where: { provider, receivedAt: { gte: since }, status: WebhookEventStatus.FAILED },
    }),
  ]);

  let status: ConnectorStatus = 'no_events_yet';
  if (lastEvent) {
    if (failedLast24h > 0) status = 'failing';
    else if (needsReviewLast24h > 0) status = 'needs_review';
    else status = 'receiving_events';
  }

  return {
    status,
    lastEventAt: lastEvent?.receivedAt ?? null,
    eventsLast24h,
    needsReviewLast24h,
    failedLast24h,
  };
}

export interface IntegrationHealth {
  api: { status: 'healthy' };
  database: { status: 'connected' | 'unavailable' };
  metaConnector: {
    status: ConnectorStatus;
    lastEventAt: string | null;
    eventsLast24h: number;
  };
  n8n: { status: 'not_configured' };
  waha: { status: 'not_configured' };
}

export async function getIntegrationHealth(): Promise<IntegrationHealth> {
  let databaseStatus: 'connected' | 'unavailable' = 'connected';
  let connector: ConnectorState = {
    status: 'no_events_yet',
    lastEventAt: null,
    eventsLast24h: 0,
    needsReviewLast24h: 0,
    failedLast24h: 0,
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    connector = await getConnectorState();
  } catch {
    databaseStatus = 'unavailable';
  }

  return {
    api: { status: 'healthy' },
    database: { status: databaseStatus },
    metaConnector: {
      status: connector.status,
      lastEventAt: connector.lastEventAt ? connector.lastEventAt.toISOString() : null,
      eventsLast24h: connector.eventsLast24h,
    },
    // No real n8n/WAHA connection check exists yet, so never claim they are connected.
    n8n: { status: 'not_configured' },
    waha: { status: 'not_configured' },
  };
}

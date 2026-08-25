import { LeadDirection, LeadSource, MappingStatus, WebhookEventStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { normalizeEmail } from '../../utils/normalize-email.js';
import { normalizePhone } from '../../utils/normalize-phone.js';

export const META_CONNECTOR_PROVIDER = 'paterhaus_meta_connector';

/**
 * Provider tag for the legacy GET ingestion adapter. Kept distinct from the
 * standard POST provider so GET-only deliveries are identifiable in the
 * webhook monitor without affecting the POST connector-state card.
 */
export const CONNECTOR_GET_PROVIDER = 'paterhaus_meta_connector_get';

export interface ExtractedLeadFields {
  name?: string;
  phone?: string;
  normalizedPhone?: string;
  email?: string;
  normalizedEmail?: string;
  propertyType?: string;
  propertyArea?: string;
  bedrooms?: number;
  serviceRaw?: string;
  externalLeadId?: string;
  submittedAt?: Date;
}

export interface AttributionFields {
  platform?: string;
  campaignExternalId?: string;
  campaignName?: string;
  adSetExternalId?: string;
  adSetName?: string;
  adExternalId?: string;
  adName?: string;
  formExternalId?: string;
  formName?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  firstTouchAt?: Date;
  capturedAt?: Date;
}

export interface WebhookIntakeResult {
  eventId: string;
  leadId: string | null;
  status: 'processed' | 'needs_review' | 'duplicate';
}

export interface ConnectorGetResult {
  eventId: string;
}

function pickString(payload: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function pickInteger(payload: Record<string, unknown>, keys: string[]): number | undefined {
  const raw = pickString(payload, keys);
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function pickDate(payload: Record<string, unknown>, keys: string[]): Date | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      // Accept both second and millisecond epochs.
      const date = new Date(value < 1e12 ? value * 1000 : value);
      if (!Number.isNaN(date.getTime())) return date;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const date = new Date(value.trim());
      if (!Number.isNaN(date.getTime())) return date;
    }
  }
  return undefined;
}

export function extractLeadFields(payload: Record<string, unknown>): ExtractedLeadFields {
  const phone = pickString(payload, ['phone_number', 'phone', 'mobile', 'phoneNumber']);
  const email = pickString(payload, ['email', 'email_address', 'emailAddress']);

  return {
    name: pickString(payload, ['name', 'full_name', 'fullName']),
    phone,
    normalizedPhone: normalizePhone(phone),
    email,
    normalizedEmail: normalizeEmail(email),
    propertyType: pickString(payload, ['property_type', 'propertyType']),
    propertyArea: pickString(payload, ['property_area', 'propertyArea', 'area']),
    bedrooms: pickInteger(payload, ['bedrooms', 'bedroom_count', 'bedroomCount']),
    serviceRaw: pickString(payload, ['service', 'service_name', 'serviceName']),
    externalLeadId: pickString(payload, ['external_lead_id', 'lead_id', 'externalLeadId', 'leadId']),
    submittedAt: pickDate(payload, ['created_at', 'submitted_at', 'timestamp', 'createdAt', 'submittedAt']),
  };
}

export function extractAttribution(payload: Record<string, unknown>): AttributionFields | undefined {
  const attribution: AttributionFields = {
    platform: pickString(payload, ['platform', 'publisher_platform', 'publisherPlatform']),
    campaignExternalId: pickString(payload, ['campaign_id', 'campaignId', 'campaign_external_id']),
    campaignName: pickString(payload, ['campaign_name', 'campaignName']),
    adSetExternalId: pickString(payload, ['adset_id', 'ad_set_id', 'adSetId']),
    adSetName: pickString(payload, ['adset_name', 'ad_set_name', 'adSetName']),
    adExternalId: pickString(payload, ['ad_id', 'adId']),
    adName: pickString(payload, ['ad_name', 'adName']),
    formExternalId: pickString(payload, ['form_id', 'formId']),
    formName: pickString(payload, ['form_name', 'formName']),
    utmSource: pickString(payload, ['utm_source', 'utmSource']),
    utmMedium: pickString(payload, ['utm_medium', 'utmMedium']),
    utmCampaign: pickString(payload, ['utm_campaign', 'utmCampaign']),
    utmContent: pickString(payload, ['utm_content', 'utmContent']),
    firstTouchAt: pickDate(payload, ['first_touch_at', 'firstTouchAt']),
    capturedAt: pickDate(payload, ['created_at', 'submitted_at', 'timestamp', 'captured_at']),
  };

  const hasAnyAttribution = Object.entries(attribution).some(
    ([key, value]) => key !== 'capturedAt' && value !== undefined,
  );

  return hasAnyAttribution ? attribution : undefined;
}

const DIRECTION_VALUES = new Set<string>(Object.values(LeadDirection));

/**
 * Resolves the lead direction from active IntegrationMapping rows only.
 * Unknown service values are never guessed — they become UNCLASSIFIED / NEEDS_REVIEW.
 */
export async function resolveDirection(
  provider: string,
  serviceRaw: string | undefined,
): Promise<{ direction: LeadDirection; mappingStatus: MappingStatus }> {
  if (!serviceRaw) {
    return { direction: LeadDirection.UNCLASSIFIED, mappingStatus: MappingStatus.NEEDS_REVIEW };
  }

  const mappings = await prisma.integrationMapping.findMany({
    where: {
      provider,
      active: true,
      sourceField: 'service',
      targetField: 'direction',
    },
  });

  const normalizedService = serviceRaw.trim().toLowerCase();
  const match = mappings.find((mapping) => mapping.sourceValue.trim().toLowerCase() === normalizedService);

  if (!match || !DIRECTION_VALUES.has(match.targetValue)) {
    return { direction: LeadDirection.UNCLASSIFIED, mappingStatus: MappingStatus.NEEDS_REVIEW };
  }

  return { direction: match.targetValue as LeadDirection, mappingStatus: MappingStatus.MAPPED };
}

export async function processMetaLeadWebhook(
  payload: Record<string, unknown>,
  safeHeaders: Record<string, string>,
): Promise<WebhookIntakeResult> {
  const provider = META_CONNECTOR_PROVIDER;
  const source = LeadSource.META_CONNECTOR;
  const fields = extractLeadFields(payload);

  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      provider,
      eventId: fields.externalLeadId ?? null,
      externalLeadId: fields.externalLeadId ?? null,
      payload: payload as Prisma.InputJsonValue,
      headers: safeHeaders as Prisma.InputJsonValue,
      status: WebhookEventStatus.RECEIVED,
      receivedAt: new Date(),
    },
  });

  try {
    if (fields.externalLeadId) {
      const existing = await prisma.lead.findFirst({
        where: { source, externalLeadId: fields.externalLeadId },
        select: { id: true },
      });

      if (existing) {
        await prisma.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: {
            status: WebhookEventStatus.DUPLICATE,
            leadId: existing.id,
            processedAt: new Date(),
          },
        });

        return { eventId: webhookEvent.id, leadId: existing.id, status: 'duplicate' };
      }
    }

    const { direction, mappingStatus } = await resolveDirection(provider, fields.serviceRaw);
    const attribution = extractAttribution(payload);
    const needsReview = mappingStatus === MappingStatus.NEEDS_REVIEW;

    const lead = await prisma.lead.create({
      data: {
        externalLeadId: fields.externalLeadId ?? null,
        name: fields.name ?? null,
        phone: fields.phone ?? null,
        normalizedPhone: fields.normalizedPhone ?? null,
        email: fields.email ?? null,
        normalizedEmail: fields.normalizedEmail ?? null,
        propertyType: fields.propertyType ?? null,
        propertyArea: fields.propertyArea ?? null,
        bedrooms: fields.bedrooms ?? null,
        serviceRaw: fields.serviceRaw ?? null,
        direction,
        mappingStatus,
        source,
        ...(attribution
          ? {
              attribution: {
                create: {
                  platform: attribution.platform ?? null,
                  campaignExternalId: attribution.campaignExternalId ?? null,
                  campaignName: attribution.campaignName ?? null,
                  adSetExternalId: attribution.adSetExternalId ?? null,
                  adSetName: attribution.adSetName ?? null,
                  adExternalId: attribution.adExternalId ?? null,
                  adName: attribution.adName ?? null,
                  formExternalId: attribution.formExternalId ?? null,
                  formName: attribution.formName ?? null,
                  utmSource: attribution.utmSource ?? null,
                  utmMedium: attribution.utmMedium ?? null,
                  utmCampaign: attribution.utmCampaign ?? null,
                  utmContent: attribution.utmContent ?? null,
                  firstTouchAt: attribution.firstTouchAt ?? null,
                  capturedAt: attribution.capturedAt ?? null,
                },
              },
            }
          : {}),
        events: {
          create: [
            {
              type: 'WEBHOOK_RECEIVED',
              description: `Webhook received from ${provider}`,
              metadata: { webhookEventId: webhookEvent.id, provider },
              occurredAt: fields.submittedAt ?? webhookEvent.receivedAt,
            },
            {
              type: 'LEAD_CREATED',
              description: 'Lead created from inbound webhook',
              metadata: { source },
            },
            ...(needsReview
              ? [
                  {
                    type: 'MAPPING_REVIEW_REQUIRED' as const,
                    description: fields.serviceRaw
                      ? `Unknown service value "${fields.serviceRaw}" requires mapping review`
                      : 'Missing service value requires mapping review',
                    metadata: { serviceRaw: fields.serviceRaw ?? null, provider },
                  },
                ]
              : []),
          ],
        },
      },
      select: { id: true },
    });

    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        status: needsReview ? WebhookEventStatus.NEEDS_REVIEW : WebhookEventStatus.PROCESSED,
        leadId: lead.id,
        processedAt: new Date(),
      },
    });

    return {
      eventId: webhookEvent.id,
      leadId: lead.id,
      status: needsReview ? 'needs_review' : 'processed',
    };
  } catch (error) {
    await prisma.webhookEvent
      .update({
        where: { id: webhookEvent.id },
        data: {
          status: WebhookEventStatus.FAILED,
          errorMessage: error instanceof Error ? error.message.slice(0, 500) : 'Unknown processing error',
          processedAt: new Date(),
        },
      })
      .catch(() => undefined);

    throw error;
  }
}

/**
 * Persists a legacy GET connector delivery as a `WebhookEvent` for inspection
 * only. Performs NO downstream side effects — no lead is created, no mappings
 * are resolved. The `key` query parameter must already be stripped by the
 * caller so the authentication token is never written to the database.
 */
export async function persistConnectorGetEvent(
  payload: Record<string, unknown>,
  safeHeaders: Record<string, string>,
): Promise<ConnectorGetResult> {
  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      provider: CONNECTOR_GET_PROVIDER,
      eventId: null,
      externalLeadId: null,
      payload: payload as Prisma.InputJsonValue,
      headers: safeHeaders as Prisma.InputJsonValue,
      status: WebhookEventStatus.PROCESSED,
      receivedAt: new Date(),
      processedAt: new Date(),
    },
  });

  return { eventId: webhookEvent.id };
}

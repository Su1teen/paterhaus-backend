import { z } from 'zod';

/**
 * The connector payload is intentionally permissive: unknown and future fields
 * must survive untouched in `WebhookEvent.payload`.
 */
export const metaLeadPayloadSchema = z.record(z.unknown());

export type MetaLeadPayload = z.infer<typeof metaLeadPayloadSchema>;

export const webhookResponseSchema = {
  type: 'object',
  properties: {
    received: { type: 'boolean', example: true },
    eventId: { type: 'string', format: 'uuid' },
    leadId: { type: 'string', format: 'uuid', nullable: true },
    status: {
      type: 'string',
      enum: ['processed', 'needs_review', 'duplicate'],
    },
  },
} as const;

export const SAMPLE_WEBHOOK_PAYLOAD = {
  name: 'Ivan Ivanov',
  phone_number: '+77001234567',
  email: 'ivan@example.com',
  property_type: 'Apartment',
  service: 'Buying property',
} as const;

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import {
  closeTestApp,
  getTestApp,
  resetDatabase,
  seedServiceMappings,
  webhookHeaders,
} from './helpers/test-app.js';

const SAMPLE_PAYLOAD = {
  name: 'Ivan Ivanov',
  phone_number: '+77001234567',
  email: 'ivan@example.com',
  property_type: 'Apartment',
  service: 'Buying property',
};

describe('POST /webhooks/meta-leads', () => {
  beforeAll(async () => {
    await getTestApp();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedServiceMappings();
  });

  it('rejects a request without an Authorization header', async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/meta-leads',
      payload: SAMPLE_PAYLOAD,
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('test_webhook_secret_value');
    expect(await prisma.webhookEvent.count()).toBe(0);
  });

  it('rejects a request with an invalid bearer secret', async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/meta-leads',
      headers: webhookHeaders('definitely_not_the_real_secret'),
      payload: SAMPLE_PAYLOAD,
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('test_webhook_secret_value');
    expect(await prisma.webhookEvent.count()).toBe(0);
  });

  it('accepts the current sample payload and stores the raw payload', async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/meta-leads',
      headers: webhookHeaders(),
      payload: SAMPLE_PAYLOAD,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.received).toBe(true);
    expect(body.eventId).toBeTypeOf('string');

    const event = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: body.eventId } });
    expect(event.provider).toBe('paterhaus_meta_connector');
    expect(event.payload).toEqual(SAMPLE_PAYLOAD);
  });

  it('never persists the Authorization header with the stored event', async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/meta-leads',
      headers: webhookHeaders(),
      payload: SAMPLE_PAYLOAD,
    });

    const event = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: response.json().eventId } });
    expect(JSON.stringify(event.headers)).not.toContain('test_webhook_secret_value');
    expect(Object.keys(event.headers as Record<string, unknown>)).not.toContain('authorization');
  });

  it('creates a normalized lead from the sample payload', async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/meta-leads',
      headers: webhookHeaders(),
      payload: { ...SAMPLE_PAYLOAD, phone_number: '+7 (700) 123-45-67', email: '  IVAN@Example.com ' },
    });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: response.json().leadId } });
    expect(lead.name).toBe('Ivan Ivanov');
    expect(lead.normalizedPhone).toBe('+77001234567');
    expect(lead.normalizedEmail).toBe('ivan@example.com');
    expect(lead.propertyType).toBe('Apartment');
    expect(lead.serviceRaw).toBe('Buying property');
    expect(lead.source).toBe('META_CONNECTOR');
  });

  it('marks unknown service "Buying property" as UNCLASSIFIED / NEEDS_REVIEW', async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/meta-leads',
      headers: webhookHeaders(),
      payload: SAMPLE_PAYLOAD,
    });

    expect(response.json().status).toBe('needs_review');

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: response.json().leadId } });
    expect(lead.direction).toBe('UNCLASSIFIED');
    expect(lead.mappingStatus).toBe('NEEDS_REVIEW');

    const events = await prisma.leadEvent.findMany({ where: { leadId: lead.id } });
    expect(events.map((event) => event.type).sort()).toEqual([
      'LEAD_CREATED',
      'MAPPING_REVIEW_REQUIRED',
      'WEBHOOK_RECEIVED',
    ]);

    const webhookEvent = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: response.json().eventId } });
    expect(webhookEvent.status).toBe('NEEDS_REVIEW');
  });

  it('maps a known service value through active integration mappings', async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/meta-leads',
      headers: webhookHeaders(),
      payload: { ...SAMPLE_PAYLOAD, service: 'Snagging' },
    });

    expect(response.json().status).toBe('processed');

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: response.json().leadId } });
    expect(lead.direction).toBe('SNAGGING');
    expect(lead.mappingStatus).toBe('MAPPED');
  });

  it('tolerates unknown extra JSON fields and preserves them in the raw payload', async () => {
    const app = await getTestApp();
    const payload = {
      ...SAMPLE_PAYLOAD,
      service: 'Staging',
      some_future_field: { nested: [1, 2, 3] },
      raw_form_answers: [{ question: 'Budget', answer: '100k' }],
    };

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/meta-leads',
      headers: webhookHeaders(),
      payload,
    });

    expect(response.statusCode).toBe(200);
    const event = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: response.json().eventId } });
    expect(event.payload).toEqual(payload);
  });

  it('creates attribution only when attribution data is present', async () => {
    const app = await getTestApp();

    const withoutAttribution = await app.inject({
      method: 'POST',
      url: '/webhooks/meta-leads',
      headers: webhookHeaders(),
      payload: SAMPLE_PAYLOAD,
    });
    expect(
      await prisma.leadAttribution.count({ where: { leadId: withoutAttribution.json().leadId } }),
    ).toBe(0);

    const withAttribution = await app.inject({
      method: 'POST',
      url: '/webhooks/meta-leads',
      headers: webhookHeaders(),
      payload: { ...SAMPLE_PAYLOAD, campaign_name: 'Dubai Marina PM', utm_source: 'facebook' },
    });
    const attribution = await prisma.leadAttribution.findUniqueOrThrow({
      where: { leadId: withAttribution.json().leadId },
    });
    expect(attribution.campaignName).toBe('Dubai Marina PM');
    expect(attribution.utmSource).toBe('facebook');
  });

  it('does not create a duplicate lead for a repeated source + externalLeadId', async () => {
    const app = await getTestApp();
    const payload = { ...SAMPLE_PAYLOAD, lead_id: 'ext-lead-0001' };

    const first = await app.inject({
      method: 'POST',
      url: '/webhooks/meta-leads',
      headers: webhookHeaders(),
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/webhooks/meta-leads',
      headers: webhookHeaders(),
      payload,
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe('duplicate');
    expect(second.json().leadId).toBe(first.json().leadId);
    expect(await prisma.lead.count()).toBe(1);
    expect(await prisma.webhookEvent.count()).toBe(2);

    const duplicateEvent = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: second.json().eventId } });
    expect(duplicateEvent.status).toBe('DUPLICATE');
    expect(duplicateEvent.processedAt).not.toBeNull();
  });

  it('rejects a non-object body with 400', async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/meta-leads',
      headers: webhookHeaders(),
      payload: JSON.stringify(['not', 'an', 'object']),
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects malformed JSON with 400', async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/meta-leads',
      headers: webhookHeaders(),
      payload: '{"name": "broken"',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('at Object.');
  });
});

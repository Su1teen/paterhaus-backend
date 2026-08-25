import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import {
  TEST_CONNECTOR_TOKEN,
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

  it('accepts POST with ?key=<CONNECTOR_WEBHOOK_TOKEN> and a JSON body when no Bearer is present', async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/meta-leads?key=${TEST_CONNECTOR_TOKEN}`,
      headers: { 'content-type': 'application/json' },
      payload: SAMPLE_PAYLOAD,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.received).toBe(true);
    expect(body.eventId).toBeTypeOf('string');
    expect(body.leadId).toBeTypeOf('string');

    const event = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: body.eventId } });
    expect(event.provider).toBe('paterhaus_meta_connector');
    expect(event.payload).toEqual(SAMPLE_PAYLOAD);

    // The connector key must never be written to the stored payload or headers.
    expect(JSON.stringify(event.payload)).not.toContain(TEST_CONNECTOR_TOKEN);
    expect(JSON.stringify(event.headers)).not.toContain(TEST_CONNECTOR_TOKEN);
    expect(event.payload).not.toHaveProperty('key');
  });

  it('rejects POST with an invalid ?key= and no Bearer with 401, storing nothing', async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/meta-leads?key=definitely_not_the_real_token',
      headers: { 'content-type': 'application/json' },
      payload: SAMPLE_PAYLOAD,
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain(TEST_CONNECTOR_TOKEN);
    expect(await prisma.webhookEvent.count()).toBe(0);
  });

  it('rejects POST with no Bearer and no key with 401, storing nothing', async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/meta-leads',
      headers: { 'content-type': 'application/json' },
      payload: SAMPLE_PAYLOAD,
    });

    expect(response.statusCode).toBe(401);
    expect(await prisma.webhookEvent.count()).toBe(0);
  });

  it('rejects POST with an invalid Bearer even when a valid ?key= is present', async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/meta-leads?key=${TEST_CONNECTOR_TOKEN}`,
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong_bearer_secret' },
      payload: SAMPLE_PAYLOAD,
    });

    // A present Bearer header takes precedence and is validated; the key
    // fallback must not rescue an invalid Bearer.
    expect(response.statusCode).toBe(401);
    expect(await prisma.webhookEvent.count()).toBe(0);
  });

  it('still accepts POST with a valid Bearer header (no key required)', async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/meta-leads',
      headers: webhookHeaders(),
      payload: SAMPLE_PAYLOAD,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().received).toBe(true);
  });

  it('makes a POST-with-key event visible in the internal webhook monitor', async () => {
    const app = await getTestApp();
    const postResponse = await app.inject({
      method: 'POST',
      url: `/webhooks/meta-leads?key=${TEST_CONNECTOR_TOKEN}`,
      headers: { 'content-type': 'application/json' },
      payload: { ...SAMPLE_PAYLOAD, lead_id: 'ext-post-key-001' },
    });
    expect(postResponse.statusCode).toBe(200);
    const eventId = postResponse.json().eventId;

    const monitor = await app.inject({
      method: 'GET',
      url: `/internal/webhook-monitor?token=${process.env.INTERNAL_DASHBOARD_SECRET}`,
    });
    expect(monitor.statusCode).toBe(200);
    expect(monitor.body).toContain('paterhaus_meta_connector');
    expect(monitor.body).not.toContain(TEST_CONNECTOR_TOKEN);

    const detail = await app.inject({
      method: 'GET',
      url: `/internal/webhook-monitor/events/${eventId}?token=${process.env.INTERNAL_DASHBOARD_SECRET}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain('ext-post-key-001');
    expect(detail.body).not.toContain(TEST_CONNECTOR_TOKEN);
  });
});

describe('GET /webhooks/meta-leads (legacy connector adapter)', () => {
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

  it('rejects a request without a key parameter with 401 and stores nothing', async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/webhooks/meta-leads?lead_id=1&name=Ivan',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ ok: false, error: 'Unauthorized' });
    expect(await prisma.webhookEvent.count()).toBe(0);
  });

  it('rejects a request with an invalid key with 401 and stores nothing', async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: 'GET',
      url: `/webhooks/meta-leads?key=definitely_not_the_real_token&lead_id=1`,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ ok: false, error: 'Unauthorized' });
    expect(await prisma.webhookEvent.count()).toBe(0);
  });

  it('accepts a valid key, stores the payload without the key, and returns 200', async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: 'GET',
      url: `/webhooks/meta-leads?key=${TEST_CONNECTOR_TOKEN}&lead_id=ext-1&name=Ivan%20Ivanov&phone=%2B77001234567&email=ivan%40example.com&test_ref=ref-001`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    const event = await prisma.webhookEvent.findFirstOrThrow();
    expect(event.provider).toBe('connector-get');
    expect(event.status).toBe('PROCESSED');
    expect(event.leadId).toBeNull();

    const payload = event.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty('key');
    expect(payload.lead_id).toBe('ext-1');
    expect(payload.name).toBe('Ivan Ivanov');
    expect(payload.phone).toBe('+77001234567');
    expect(payload.email).toBe('ivan@example.com');
    expect(payload.test_ref).toBe('ref-001');

    const headers = event.headers as Record<string, unknown>;
    expect(headers['x-request-method']).toBe('GET');
    expect(JSON.stringify(headers)).not.toContain(TEST_CONNECTOR_TOKEN);
  });

  it('preserves repeated query parameters as arrays', async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: 'GET',
      url: `/webhooks/meta-leads?key=${TEST_CONNECTOR_TOKEN}&tag=a&tag=b&tag=c`,
    });

    expect(response.statusCode).toBe(200);
    const event = await prisma.webhookEvent.findFirstOrThrow();
    expect((event.payload as Record<string, unknown>).tag).toEqual(['a', 'b', 'c']);
  });

  it('does not create a lead or any downstream side effects', async () => {
    const app = await getTestApp();
    await app.inject({
      method: 'GET',
      url: `/webhooks/meta-leads?key=${TEST_CONNECTOR_TOKEN}&lead_id=ext-1&name=Ivan&service=Snagging`,
    });

    expect(await prisma.lead.count()).toBe(0);
    expect(await prisma.leadEvent.count()).toBe(0);
    expect(await prisma.leadAttribution.count()).toBe(0);
    expect(await prisma.webhookEvent.count()).toBe(1);
  });

  it('appears in the internal webhook monitor list', async () => {
    const app = await getTestApp();
    await app.inject({
      method: 'GET',
      url: `/webhooks/meta-leads?key=${TEST_CONNECTOR_TOKEN}&lead_id=ext-1&name=Ivan`,
    });

    const monitor = await app.inject({
      method: 'GET',
      url: `/internal/webhook-monitor?token=${process.env.INTERNAL_DASHBOARD_SECRET}`,
    });

    expect(monitor.statusCode).toBe(200);
    expect(monitor.body).toContain('connector-get');
    expect(monitor.body).not.toContain(TEST_CONNECTOR_TOKEN);
  });

  it('verifies a test_ref=monitor-check-001 GET event appears in the monitor query', async () => {
    const app = await getTestApp();

    // Send a legacy GET delivery marked with a unique reference so we can
    // prove this exact event is readable through the internal monitor.
    const getResponse = await app.inject({
      method: 'GET',
      url: `/webhooks/meta-leads?key=${TEST_CONNECTOR_TOKEN}&test_ref=monitor-check-001&lead_id=ext-monitor&name=Monitor%20Check`,
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toEqual({ ok: true });

    // The stored event must carry the connector-get provider and the marker,
    // with the key stripped from the payload.
    const event = await prisma.webhookEvent.findFirstOrThrow();
    expect(event.provider).toBe('connector-get');
    expect((event.payload as Record<string, unknown>).test_ref).toBe('monitor-check-001');
    expect(event.payload).not.toHaveProperty('key');

    // The monitor list query (the same `listWebhookEvents` the dashboard runs)
    // must surface the event — the provider column renders `connector-get`.
    const monitorList = await app.inject({
      method: 'GET',
      url: `/internal/webhook-monitor?token=${process.env.INTERNAL_DASHBOARD_SECRET}`,
    });
    expect(monitorList.statusCode).toBe(200);
    expect(monitorList.body).toContain('connector-get');
    expect(monitorList.body).not.toContain(TEST_CONNECTOR_TOKEN);
    expect(monitorList.body).not.toContain('monitor-check-001');

    // The monitor detail query must render this exact event's raw payload,
    // proving the `test_ref` marker survives end-to-end through the monitor.
    const monitorDetail = await app.inject({
      method: 'GET',
      url: `/internal/webhook-monitor/events/${event.id}?token=${process.env.INTERNAL_DASHBOARD_SECRET}`,
    });
    expect(monitorDetail.statusCode).toBe(200);
    expect(monitorDetail.body).toContain('connector-get');
    expect(monitorDetail.body).toContain('monitor-check-001');
    expect(monitorDetail.body).not.toContain(TEST_CONNECTOR_TOKEN);
  });

  it('does not interfere with the existing POST Bearer endpoint', async () => {
    const app = await getTestApp();

    const postResponse = await app.inject({
      method: 'POST',
      url: '/webhooks/meta-leads',
      headers: webhookHeaders(),
      payload: SAMPLE_PAYLOAD,
    });
    expect(postResponse.statusCode).toBe(200);
    expect(postResponse.json().received).toBe(true);

    const getResponse = await app.inject({
      method: 'GET',
      url: `/webhooks/meta-leads?key=${TEST_CONNECTOR_TOKEN}&lead_id=ext-get-1`,
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toEqual({ ok: true });

    const events = await prisma.webhookEvent.findMany({ orderBy: { receivedAt: 'asc' } });
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.provider).sort()).toEqual([
      'connector-get',
      'paterhaus_meta_connector',
    ]);
  });
});

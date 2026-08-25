import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import {
  TEST_DASHBOARD_SECRET,
  TEST_WEBHOOK_SECRET,
  closeTestApp,
  getTestApp,
  resetDatabase,
  seedServiceMappings,
  webhookHeaders,
} from './helpers/test-app.js';

const MONITOR_URL = '/internal/webhook-monitor';

async function postWebhook(payload: Record<string, unknown>): Promise<{ eventId: string; leadId: string }> {
  const app = await getTestApp();
  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/meta-leads',
    headers: webhookHeaders(),
    payload,
  });
  return response.json();
}

describe('Integration review API', () => {
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

  it('does not claim external services are connected', async () => {
    const app = await getTestApp();
    const response = await app.inject({ method: 'GET', url: '/integrations/health' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.api.status).toBe('healthy');
    expect(body.database.status).toBe('connected');
    expect(body.n8n.status).toBe('not_configured');
    expect(body.waha.status).toBe('not_configured');
    expect(body.metaConnector.status).toBe('no_events_yet');
    expect(body.metaConnector.lastEventAt).toBeNull();
    expect(body.metaConnector.eventsLast24h).toBe(0);
  });

  it('reports connector activity only after real events arrive', async () => {
    const app = await getTestApp();
    await postWebhook({ name: 'Ivan Ivanov', service: 'Snagging' });

    const body = (await app.inject({ method: 'GET', url: '/integrations/health' })).json();
    expect(body.metaConnector.status).toBe('receiving_events');
    expect(body.metaConnector.eventsLast24h).toBe(1);
    expect(body.metaConnector.lastEventAt).toBeTypeOf('string');
  });

  it('lists webhook events newest first and never exposes stored headers', async () => {
    const app = await getTestApp();
    await postWebhook({ name: 'First Lead', service: 'Snagging', lead_id: 'ext-1' });
    await postWebhook({ name: 'Second Lead', service: 'Staging', lead_id: 'ext-2' });

    const response = await app.inject({ method: 'GET', url: '/integrations/webhook-events' });
    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data).toHaveLength(2);
    expect(new Date(data[0].receivedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(data[1].receivedAt).getTime(),
    );
    expect(data[0].lead.name).toBe('Second Lead');
    expect(data[0].headers).toBeUndefined();
    expect(response.body).not.toContain(TEST_WEBHOOK_SECRET);
  });

  it('filters webhook events by status', async () => {
    const app = await getTestApp();
    await postWebhook({ name: 'Mapped Lead', service: 'Snagging' });
    await postWebhook({ name: 'Review Lead', service: 'Buying property' });

    const response = await app.inject({ method: 'GET', url: '/integrations/webhook-events?status=NEEDS_REVIEW' });
    const { data } = response.json();
    expect(data).toHaveLength(1);
    expect(data[0].lead.name).toBe('Review Lead');
  });

  it('returns the stored raw payload on the event detail endpoint', async () => {
    const app = await getTestApp();
    const payload = { name: 'Detail Lead', service: 'Snagging', extra_field: 'kept' };
    const { eventId } = await postWebhook(payload);

    const response = await app.inject({ method: 'GET', url: `/integrations/webhook-events/${eventId}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().payload).toEqual(payload);
    expect(response.json().headers).toBeUndefined();
  });

  it('supports integration mapping CRUD', async () => {
    const app = await getTestApp();

    const created = await app.inject({
      method: 'POST',
      url: '/integrations/mappings',
      payload: {
        provider: 'paterhaus_meta_connector',
        sourceField: 'service',
        sourceValue: 'Buying property',
        targetField: 'direction',
        targetValue: 'PROPERTY_MANAGEMENT',
      },
    });
    expect(created.statusCode).toBe(201);
    const mapping = created.json();

    const listed = await app.inject({
      method: 'GET',
      url: '/integrations/mappings?provider=paterhaus_meta_connector&active=true',
    });
    expect(listed.json()).toHaveLength(4);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/integrations/mappings/${mapping.id}`,
      payload: { active: false },
    });
    expect(updated.json().active).toBe(false);

    const invalid = await app.inject({
      method: 'POST',
      url: '/integrations/mappings',
      payload: { provider: 'paterhaus_meta_connector' },
    });
    expect(invalid.statusCode).toBe(400);
  });
});

describe('Temporary internal webhook monitor', () => {
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

  it('rejects a request without a token', async () => {
    const app = await getTestApp();
    const response = await app.inject({ method: 'GET', url: MONITOR_URL });

    expect([401, 403]).toContain(response.statusCode);
    expect(response.body).not.toContain(TEST_DASHBOARD_SECRET);
  });

  it('rejects a request with an invalid token', async () => {
    const app = await getTestApp();
    const response = await app.inject({ method: 'GET', url: `${MONITOR_URL}?token=wrong_token_value` });

    expect([401, 403]).toContain(response.statusCode);
    expect(response.body).not.toContain(TEST_DASHBOARD_SECRET);
  });

  it('renders with a valid token and reports "no events" honestly', async () => {
    const app = await getTestApp();
    const response = await app.inject({ method: 'GET', url: `${MONITOR_URL}?token=${TEST_DASHBOARD_SECRET}` });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toContain('Paterhaus Webhook Monitor');
    expect(response.body).toContain('No events received yet');
    expect(response.body).not.toContain('Receiving events</div>');
  });

  it('distinguishes receiving, needs-review and failing states', async () => {
    const app = await getTestApp();

    await postWebhook({ name: 'Mapped Lead', service: 'Snagging' });
    let body = (await app.inject({ method: 'GET', url: `${MONITOR_URL}?token=${TEST_DASHBOARD_SECRET}` })).body;
    expect(body).toContain('Receiving events');

    await postWebhook({ name: 'Review Lead', service: 'Buying property' });
    body = (await app.inject({ method: 'GET', url: `${MONITOR_URL}?token=${TEST_DASHBOARD_SECRET}` })).body;
    expect(body).toContain('Events need mapping review');

    await prisma.webhookEvent.create({
      data: { provider: 'paterhaus_meta_connector', payload: { failed: true }, status: 'FAILED' },
    });
    body = (await app.inject({ method: 'GET', url: `${MONITOR_URL}?token=${TEST_DASHBOARD_SECRET}` })).body;
    expect(body).toContain('Events failing');
  });

  it('lists events newest first', async () => {
    const app = await getTestApp();
    await postWebhook({ name: 'Older Lead', service: 'Snagging', lead_id: 'ext-old' });
    await postWebhook({ name: 'Newer Lead', service: 'Staging', lead_id: 'ext-new' });

    const body = (await app.inject({ method: 'GET', url: `${MONITOR_URL}?token=${TEST_DASHBOARD_SECRET}` })).body;
    expect(body.indexOf('Newer Lead')).toBeLessThan(body.indexOf('Older Lead'));
  });

  it('never renders secrets, Authorization values or the database URL', async () => {
    const app = await getTestApp();
    await postWebhook({ name: 'Ivan Ivanov', service: 'Snagging' });

    const listBody = (await app.inject({ method: 'GET', url: `${MONITOR_URL}?token=${TEST_DASHBOARD_SECRET}` }))
      .body;
    const eventId = (await prisma.webhookEvent.findFirstOrThrow()).id;
    const detailBody = (
      await app.inject({
        method: 'GET',
        url: `${MONITOR_URL}/events/${eventId}?token=${TEST_DASHBOARD_SECRET}`,
      })
    ).body;

    for (const body of [listBody, detailBody]) {
      expect(body).not.toContain(TEST_WEBHOOK_SECRET);
      expect(body.toLowerCase()).not.toContain('authorization');
      expect(body).not.toContain('postgresql://');
      expect(body).not.toContain('DATABASE_URL');
      expect(body).not.toContain('INTERNAL_DASHBOARD_SECRET');
    }
  });

  it('escapes payload values on the event detail page', async () => {
    const app = await getTestApp();
    await postWebhook({
      name: '<script>alert("xss")</script>',
      service: 'Snagging',
      note: '"><img src=x onerror=alert(1)>',
    });

    const eventId = (await prisma.webhookEvent.findFirstOrThrow()).id;
    const response = await app.inject({
      method: 'GET',
      url: `${MONITOR_URL}/events/${eventId}?token=${TEST_DASHBOARD_SECRET}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('<script>alert');
    expect(response.body).not.toContain('<img src=x');
    expect(response.body).toContain('&lt;script&gt;');
  });

  it('rejects the event detail page without a valid token', async () => {
    const app = await getTestApp();
    await postWebhook({ name: 'Ivan Ivanov', service: 'Snagging' });
    const eventId = (await prisma.webhookEvent.findFirstOrThrow()).id;

    const noToken = await app.inject({ method: 'GET', url: `${MONITOR_URL}/events/${eventId}` });
    expect([401, 403]).toContain(noToken.statusCode);

    const badToken = await app.inject({ method: 'GET', url: `${MONITOR_URL}/events/${eventId}?token=nope` });
    expect([401, 403]).toContain(badToken.statusCode);
  });

  it('paginates and caps the page size', async () => {
    const app = await getTestApp();
    for (let index = 0; index < 3; index += 1) {
      await postWebhook({ name: `Lead ${index}`, service: 'Snagging', lead_id: `ext-${index}` });
    }

    const firstPage = await app.inject({
      method: 'GET',
      url: `${MONITOR_URL}?token=${TEST_DASHBOARD_SECRET}&page=1&limit=2`,
    });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.body).toContain('Page 1 of 2');

    const tooLarge = await app.inject({
      method: 'GET',
      url: `${MONITOR_URL}?token=${TEST_DASHBOARD_SECRET}&limit=5000`,
    });
    expect([401, 403]).not.toContain(tooLarge.statusCode);
  });
});

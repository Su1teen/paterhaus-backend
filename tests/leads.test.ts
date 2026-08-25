import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { closeTestApp, getTestApp, resetDatabase } from './helpers/test-app.js';

describe('Leads API', () => {
  beforeAll(async () => {
    await getTestApp();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates, reads, updates and deletes a lead', async () => {
    const app = await getTestApp();

    const created = await app.inject({
      method: 'POST',
      url: '/leads',
      payload: {
        name: 'Aisha Khan',
        phone: '+971 50 123 4567',
        email: 'Aisha@Example.com',
        propertyType: 'Villa',
        serviceRaw: 'Snagging',
        direction: 'SNAGGING',
        source: 'WEBSITE',
      },
    });

    expect(created.statusCode).toBe(201);
    const lead = created.json();
    expect(lead.normalizedPhone).toBe('+971501234567');
    expect(lead.normalizedEmail).toBe('aisha@example.com');
    expect(lead.stage).toBe('new');
    expect(lead.mappingStatus).toBe('MAPPED');

    const fetched = await app.inject({ method: 'GET', url: `/leads/${lead.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().id).toBe(lead.id);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/leads/${lead.id}`,
      payload: { stage: 'contacted' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().stage).toBe('contacted');

    const stageEvents = await prisma.leadEvent.findMany({ where: { leadId: lead.id, type: 'STAGE_CHANGED' } });
    expect(stageEvents).toHaveLength(1);

    const deleted = await app.inject({ method: 'DELETE', url: `/leads/${lead.id}` });
    expect(deleted.statusCode).toBe(204);
    expect(await prisma.lead.count()).toBe(0);
  });

  it('validates lead input', async () => {
    const app = await getTestApp();

    const badEmail = await app.inject({
      method: 'POST',
      url: '/leads',
      payload: { name: 'Bad Email', email: 'not-an-email' },
    });
    expect(badEmail.statusCode).toBe(400);
    expect(badEmail.json().error).toBe('Bad Request');

    const badDirection = await app.inject({
      method: 'POST',
      url: '/leads',
      payload: { name: 'Bad Direction', direction: 'NOT_A_DIRECTION' },
    });
    expect(badDirection.statusCode).toBe(400);

    const badUuid = await app.inject({ method: 'GET', url: '/leads/not-a-uuid' });
    expect(badUuid.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'GET',
      url: '/leads/11111111-1111-4111-8111-111111111111',
    });
    expect(missing.statusCode).toBe(404);
  });

  it('filters and paginates the lead list', async () => {
    const app = await getTestApp();

    await prisma.lead.createMany({
      data: [
        { name: 'Snag One', source: 'WEBSITE', direction: 'SNAGGING', stage: 'new' },
        { name: 'Stage Two', source: 'REFERRAL', direction: 'STAGING', stage: 'qualified' },
        {
          name: 'Unclassified Three',
          source: 'META_CONNECTOR',
          direction: 'UNCLASSIFIED',
          mappingStatus: 'NEEDS_REVIEW',
          email: 'three@example.com',
          normalizedEmail: 'three@example.com',
        },
      ],
    });

    const byDirection = await app.inject({ method: 'GET', url: '/leads?direction=SNAGGING' });
    expect(byDirection.json().data).toHaveLength(1);

    const byMappingStatus = await app.inject({ method: 'GET', url: '/leads?mappingStatus=NEEDS_REVIEW' });
    expect(byMappingStatus.json().data).toHaveLength(1);

    const bySearch = await app.inject({ method: 'GET', url: '/leads?search=three@example' });
    expect(bySearch.json().data).toHaveLength(1);

    const paginated = await app.inject({ method: 'GET', url: '/leads?page=1&limit=2' });
    expect(paginated.json().data).toHaveLength(2);
    expect(paginated.json().meta).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
  });

  it('caps the page size at the safe maximum', async () => {
    const app = await getTestApp();
    const response = await app.inject({ method: 'GET', url: '/leads?limit=5000' });
    expect(response.json().meta.limit).toBe(100);
  });
});

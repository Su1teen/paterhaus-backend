import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { closeTestApp, getTestApp, resetDatabase } from './helpers/test-app.js';

const VALID_CAMPAIGN = {
  name: 'Dubai Marina - Property Management',
  platform: 'INSTAGRAM',
  direction: 'PROPERTY_MANAGEMENT',
  status: 'ACTIVE',
  spendUsd: 1500.5,
};
  //tst
describe('Campaigns API', () => {
  beforeAll(async () => {
    await getTestApp();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates, reads, updates and deletes a campaign', async () => {
    const app = await getTestApp();

    const created = await app.inject({ method: 'POST', url: '/campaigns', payload: VALID_CAMPAIGN });
    expect(created.statusCode).toBe(201);
    const campaign = created.json();
    expect(campaign.spendUsd).toBe(1500.5);

    const fetched = await app.inject({ method: 'GET', url: `/campaigns/${campaign.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().leadCount).toBe(0);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/campaigns/${campaign.id}`,
      payload: { status: 'PAUSED', spendUsd: 2000 },
    });
    expect(updated.json()).toMatchObject({ status: 'PAUSED', spendUsd: 2000 });

    const deleted = await app.inject({ method: 'DELETE', url: `/campaigns/${campaign.id}` });
    expect(deleted.statusCode).toBe(204);
    expect(await prisma.campaign.count()).toBe(0);
  });

  it('validates required fields, enums and non-negative spend', async () => {
    const app = await getTestApp();

    const missingFields = await app.inject({ method: 'POST', url: '/campaigns', payload: { name: 'Nameless' } });
    expect(missingFields.statusCode).toBe(400);

    const badPlatform = await app.inject({
      method: 'POST',
      url: '/campaigns',
      payload: { ...VALID_CAMPAIGN, platform: 'TIKTOK' },
    });
    expect(badPlatform.statusCode).toBe(400);

    const negativeSpend = await app.inject({
      method: 'POST',
      url: '/campaigns',
      payload: { ...VALID_CAMPAIGN, spendUsd: -10 },
    });
    expect(negativeSpend.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'GET',
      url: '/campaigns/11111111-1111-4111-8111-111111111111',
    });
    expect(missing.statusCode).toBe(404);
  });

  it('filters campaigns by direction and status', async () => {
    const app = await getTestApp();

    await app.inject({ method: 'POST', url: '/campaigns', payload: VALID_CAMPAIGN });
    await app.inject({
      method: 'POST',
      url: '/campaigns',
      payload: { ...VALID_CAMPAIGN, name: 'Snagging Push', direction: 'SNAGGING', status: 'DRAFT' },
    });

    const byDirection = await app.inject({ method: 'GET', url: '/campaigns?direction=SNAGGING' });
    expect(byDirection.json().data).toHaveLength(1);

    const byStatus = await app.inject({ method: 'GET', url: '/campaigns?status=ACTIVE' });
    expect(byStatus.json().data).toHaveLength(1);
    expect(byStatus.json().meta.total).toBe(1);
  });
});

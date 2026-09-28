import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestApp, getTestApp, resetDatabase } from './helpers/test-app.js';

beforeAll(async () => { await getTestApp(); });
afterAll(async () => { await closeTestApp(); });
beforeEach(async () => { await resetDatabase(); });

async function headers(email: string) {
  const app = await getTestApp();
  const login = await app.inject({ method: 'POST', url: '/api/paterhaus/auth/login',
    payload: { email, password: 'test-password' } });
  expect(login.statusCode).toBe(200);
  return { authorization: `Bearer ${login.json().accessToken}` };
}

describe('shared production CRM against disposable PostgreSQL', () => {
  it('shares marketing campaigns and canonical leads between roles with persistent archive and edits', async () => {
    const app = await getTestApp();
    const marketing = await headers('r_tszi@paterhaus.com');
    const admin = await headers('info@paterhaus.com');
    const campaign = await app.inject({ method: 'POST', url: '/api/paterhaus/marketing/campaigns', headers: marketing,
      payload: { name: 'Snagging campaign', platform: 'INSTAGRAM', direction: 'SNAGGING', status: 'ACTIVE', spendAmount: 300, currency: 'AED' } });
    expect(campaign.statusCode).toBe(201);
    expect(campaign.json().spendAmount).toBe('300');
    const lead = await app.inject({ method: 'POST', url: '/leads', headers: marketing,
      payload: { name: 'Owner A', phone: '+971 50 123 4567', source: 'MANUAL', direction: 'SNAGGING', campaignId: campaign.json().id } });
    expect(lead.statusCode).toBe(201);
    const id = lead.json().id;
    const fromAdmin = await app.inject({ method: 'GET', url: '/leads', headers: admin });
    expect(fromAdmin.json().data).toContainEqual(expect.objectContaining({ id, name: 'Owner A' }));
    const followUp = await app.inject({ method: 'PATCH', url: `/leads/${id}`, headers: admin,
      payload: { stage: 'qualified', nextActionType: 'FOLLOW_UP', nextActionAt: '2026-10-01T10:00:00Z', quotedAmount: 12000 } });
    expect(followUp.statusCode).toBe(200);
    const seenByMarketing = await app.inject({ method: 'GET', url: `/leads/${id}`, headers: marketing });
    expect(seenByMarketing.json()).toMatchObject({ stage: 'qualified', nextActionType: 'FOLLOW_UP', quotedAmount: '12000' });
    await app.inject({ method: 'PATCH', url: `/api/paterhaus/leads/${id}/archive`, headers: marketing, payload: { archived: true } });
    expect((await app.inject({ method: 'GET', url: '/leads', headers: admin })).json().data).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/leads?archived=true', headers: admin })).json().data).toHaveLength(1);
    await app.inject({ method: 'PATCH', url: `/api/paterhaus/leads/${id}/archive`, headers: admin, payload: { archived: false } });
    expect((await app.inject({ method: 'GET', url: '/leads', headers: marketing })).json().data).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/api/paterhaus/marketing/overview', headers: marketing })).json()).toMatchObject({ leads: 1, qualified: 1, spend: { AED: '300.00' } });
  });

  it('tracks project payments, contractors and milestones and recalculates overview without manual KPI entry', async () => {
    const app = await getTestApp();
    const admin = await headers('info@paterhaus.com');
    const marketing = await headers('r_tszi@paterhaus.com');
    const property = await app.inject({ method: 'POST', url: '/api/paterhaus/properties', headers: admin, payload: { name: 'Marina apartment' } });
    const contractor = await app.inject({ method: 'POST', url: '/api/paterhaus/contractors', headers: admin,
      payload: { name: 'Snagging supplier', serviceTypes: ['SNAGGING', 'STAGING'] } });
    const project = await app.inject({ method: 'POST', url: '/api/paterhaus/projects', headers: admin,
      payload: { name: 'Snagging and staging', propertyId: property.json().id, serviceDirections: ['SNAGGING', 'STAGING'],
        status: 'CONFIRMED', agreedAmount: 10000, currency: 'AED' } });
    expect(project.statusCode).toBe(201);
    expect(project.json().money).toMatchObject({ quoted: null, agreed: '10000.00', outstanding: '10000.00' });
    const id = project.json().id;
    const assignment = await app.inject({ method: 'POST', url: `/api/paterhaus/projects/${id}/contractors`, headers: admin,
      payload: { contractorId: contractor.json().id } });
    expect(assignment.statusCode).toBe(201);
    const milestone = await app.inject({ method: 'POST', url: `/api/paterhaus/projects/${id}/milestones`, headers: admin,
      payload: { title: 'Deposit received', sortOrder: 1, completedAt: new Date().toISOString() } });
    expect(milestone.statusCode).toBe(201);
    const payment = await app.inject({ method: 'POST', url: `/api/paterhaus/projects/${id}/payments`, headers: admin,
      payload: { amount: 3000, currency: 'AED', type: 'PREPAYMENT', status: 'PAID', paidAt: new Date().toISOString() } });
    expect(payment.statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: `/api/paterhaus/projects/${id}`, headers: admin })).json().money).toMatchObject({ paid: '3000.00', outstanding: '7000.00' });
    const overview = (await app.inject({ method: 'GET', url: '/api/paterhaus/analytics/overview', headers: admin })).json();
    expect(overview.operations).toMatchObject({ activeProjects: 1, awaitingContractor: 0 });
    expect(overview.finance).toMatchObject({ contractedValue: { AED: '10000.00' }, revenueCollected: { AED: '3000.00' }, outstanding: { AED: '7000.00' } });
    expect((await app.inject({ method: 'GET', url: '/api/paterhaus/projects', headers: marketing })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/paterhaus/projects/${id}`, headers: admin })).statusCode).toBe(409);
  });

  it('assigns leads to CRM users, records lost reasons and exposes assignable users to both roles', async () => {
    const app = await getTestApp();
    const { prisma } = await import('../src/lib/prisma.js');
    const admin = await headers('info@paterhaus.com');
    const marketing = await headers('r_tszi@paterhaus.com');
    const user = await prisma.user.create({ data: { email: 'ops@paterhaus.com', name: 'Ops Manager', role: 'OPERATIONS' } });
    const users = await app.inject({ method: 'GET', url: '/api/paterhaus/users', headers: marketing });
    expect(users.statusCode).toBe(200);
    expect(users.json().items).toContainEqual(expect.objectContaining({ id: user.id, email: 'ops@paterhaus.com' }));
    const lead = await app.inject({ method: 'POST', url: '/leads', headers: marketing,
      payload: { name: 'Owner B', source: 'MANUAL', direction: 'SNAGGING' } });
    const id = lead.json().id;
    const assigned = await app.inject({ method: 'PATCH', url: `/leads/${id}`, headers: admin,
      payload: { assignedUserId: user.id } });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().assignedUser).toMatchObject({ id: user.id, name: 'Ops Manager' });
    const lost = await app.inject({ method: 'PATCH', url: `/leads/${id}`, headers: marketing,
      payload: { stage: 'lost', lostReason: 'Price above budget' } });
    expect(lost.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/leads/${id}`, headers: admin })).json())
      .toMatchObject({ stage: 'lost', lostReason: 'Price above budget', assignedUser: { id: user.id } });
    const opportunities = await app.inject({ method: 'GET', url: '/api/paterhaus/opportunities', headers: admin });
    expect(opportunities.json().items).toContainEqual(expect.objectContaining({ id, assignedUser: { id: user.id } }));
  });
});

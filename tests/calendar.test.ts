import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestApp, getTestApp, resetDatabase } from './helpers/test-app.js';

async function accessToken(app: FastifyInstance, email = 'r_tszi@paterhaus.com'): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/paterhaus/conversations/access-token',
    payload: { email },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ accessToken: string }>().accessToken;
}

describe('Paterhaus calendar API', () => {
  beforeAll(async () => {
    await getTestApp();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('requires an allowlisted CRM token', async () => {
    const app = await getTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/paterhaus/calendar/events' });
    expect(response.statusCode).toBe(401);
  });

  it('creates, lists (Asia/Dubai calendar days) and deletes events that persist across requests', async () => {
    const app = await getTestApp();
    const token = await accessToken(app);
    const headers = { authorization: `Bearer ${token}` };

    const created = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/calendar/events',
      headers,
      payload: {
        title: 'Snagging inspection - Marina Gate',
        eventDate: '2026-09-14',
        startTime: '10:00',
        endTime: '12:30',
        kind: 'operation',
        description: '  Bring the checklist  ',
      },
    });
    expect(created.statusCode).toBe(201);
    const event = created.json();
    expect(event).toMatchObject({
      title: 'Snagging inspection - Marina Gate',
      eventDate: '2026-09-14',
      startTime: '10:00',
      endTime: '12:30',
      kind: 'operation',
      description: 'Bring the checklist',
      createdBy: 'r_tszi@paterhaus.com',
    });

    const outside = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/calendar/events',
      headers,
      payload: { title: 'October handover', eventDate: '2026-10-02' },
    });
    expect(outside.statusCode).toBe(201);
    expect(outside.json()).toMatchObject({ startTime: null, endTime: null, kind: 'operation', description: null });

    const september = await app.inject({
      method: 'GET',
      url: '/api/paterhaus/calendar/events?from=2026-09-01&to=2026-09-30',
      headers: { authorization: `Bearer ${await accessToken(app, 'info@paterhaus.com')}` },
    });
    expect(september.statusCode).toBe(200);
    expect(september.json()).toMatchObject({ timeZone: 'Asia/Dubai' });
    expect(september.json().items.map((item: { id: string }) => item.id)).toEqual([event.id]);

    const all = await app.inject({ method: 'GET', url: '/api/paterhaus/calendar/events', headers });
    expect(all.json().items).toHaveLength(2);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/paterhaus/calendar/events/${event.id}`,
      headers,
    });
    expect(deleted.statusCode).toBe(204);

    const afterDelete = await app.inject({ method: 'GET', url: '/api/paterhaus/calendar/events', headers });
    expect(afterDelete.json().items.map((item: { title: string }) => item.title)).toEqual(['October handover']);

    const again = await app.inject({
      method: 'DELETE',
      url: `/api/paterhaus/calendar/events/${event.id}`,
      headers,
    });
    expect(again.statusCode).toBe(404);
  });

  it.each([
    ['blank title', { title: '  ', eventDate: '2026-09-14' }],
    ['non ISO date', { title: 'x', eventDate: '14/09/2026' }],
    ['bad time', { title: 'x', eventDate: '2026-09-14', startTime: '25:00' }],
    ['end before start', { title: 'x', eventDate: '2026-09-14', startTime: '12:00', endTime: '09:00' }],
    ['unknown kind', { title: 'x', eventDate: '2026-09-14', kind: 'party' }],
  ])('rejects %s with 400', async (_label, payload) => {
    const app = await getTestApp();
    const token = await accessToken(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/calendar/events',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    expect(response.statusCode).toBe(400);
  });
});

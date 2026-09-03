import type { QueryResult, QueryResultRow } from 'pg';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { ConversationQueryClient } from '../src/modules/conversations/conversation.repository.js';
import { LeadClassificationRepository } from '../src/modules/lead-classifications/lead-classification.repository.js';

interface QueryCall {
  text: string;
  values: readonly unknown[] | undefined;
}

function queryResult<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return { command: 'SELECT', rowCount: rows.length, oid: 0, fields: [], rows };
}

function createRepository(responses: QueryResultRow[][]): {
  repository: LeadClassificationRepository;
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  const query: ConversationQueryClient['query'] = async <Row extends QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ) => {
    calls.push({ text, values });
    return queryResult((responses.shift() ?? []) as Row[]);
  };
  return { repository: new LeadClassificationRepository({ query }), calls };
}

const apps: FastifyInstance[] = [];

async function createApp(repository?: LeadClassificationRepository): Promise<FastifyInstance> {
  const app = await buildApp({ leadClassifications: { repository } });
  apps.push(app);
  return app;
}

async function accessToken(app: FastifyInstance, email = 'r_tszi@paterhaus.com'): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/paterhaus/conversations/access-token',
    payload: { email },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ accessToken: string }>().accessToken;
}

const TABLE_LOOKUP_ROW = {
  table_schema: 'public',
  table_name: 'lead_classifications',
  columns: [
    'id',
    'chat_id',
    'number',
    'username',
    'name',
    'summary',
    'lead_type',
    'stage',
    'priority',
    'work_type',
    'created_at',
    'updated_at',
  ],
};

const CLASSIFICATION_ROW = {
  id: 3,
  chat_id: '77021464983@c.us',
  number: '77021464983',
  username: 'sultan',
  name: null,
  summary: 'Wants staging for a 3-bedroom apartment',
  lead_type: 'Apartment',
  stage: 'qualified',
  priority: 'High',
  work_type: 'Staging',
  created_at: new Date('2026-08-20T10:00:00.000Z'),
  updated_at: new Date('2026-08-28T18:00:00.000Z'),
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Paterhaus lead classifications API', () => {
  it('requires an authenticated allowlisted account', async () => {
    const app = await createApp(createRepository([]).repository);

    const response = await app.inject({
      method: 'GET',
      url: '/api/paterhaus/lead-classifications',
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns classifications sorted by priority then updated_at with mapped fields', async () => {
    const { repository, calls } = createRepository([[TABLE_LOOKUP_ROW], [CLASSIFICATION_ROW]]);
    const app = await createApp(repository);
    const token = await accessToken(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/paterhaus/lead-classifications',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      nextCursor: null,
      supportsArchive: false,
      items: [
        {
          id: 3,
          chatId: '77021464983@c.us',
          number: '77021464983',
          displayName: 'sultan',
          email: null,
          leadType: 'Apartment',
          stage: 'qualified',
          priority: 'High',
          workType: 'Staging',
          createdAt: '2026-08-20T10:00:00.000Z',
          updatedAt: '2026-08-28T18:00:00.000Z',
          isActive: null,
        },
      ],
    });
    expect(calls[0]?.text).toContain('information_schema.columns');
    expect(calls[1]?.text).toContain('FROM "public"."lead_classifications"');
    expect(calls[1]?.text).toMatch(/ORDER BY\s+CASE LOWER\(BTRIM\(COALESCE\(priority, ''\)\)\)/);
    expect(calls[1]?.text).toContain("WHEN 'urgent' THEN 0");
    expect(calls[1]?.text).toContain('updated_at DESC NULLS LAST, id DESC');
    expect(calls[1]?.text).not.toContain('is_active');
    expect(calls[1]?.text).not.toContain('email');
  });

  it('filters archived rows only when the deployed table has is_active', async () => {
    const { repository, calls } = createRepository([
      [{ ...TABLE_LOOKUP_ROW, columns: [...TABLE_LOOKUP_ROW.columns, 'is_active'] }],
      [{ ...CLASSIFICATION_ROW, is_active: true }],
    ]);
    const app = await createApp(repository);
    const token = await accessToken(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/paterhaus/lead-classifications',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      supportsArchive: true,
      items: [{ isActive: true }],
    });
    expect(calls[1]?.text).toContain('WHERE COALESCE(is_active, TRUE)');
  });

  it('returns 503 without leaking driver details when the table cannot be resolved', async () => {
    const { repository } = createRepository([[]]);
    const app = await createApp(repository);
    const token = await accessToken(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/paterhaus/lead-classifications',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('information_schema');
  });

  it('returns 503 when the external database rejects the query', async () => {
    const repository = new LeadClassificationRepository({
      query: async () => {
        throw new Error('password authentication failed');
      },
    });
    const app = await createApp(repository);
    const token = await accessToken(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/paterhaus/lead-classifications',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('password');
  });
});

async function forgedToken(email: string): Promise<string> {
  return new SignJWT({ email, feature: 'paterhaus-conversations' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(process.env.CRM_JWT_SECRET ?? ''));
}

const MANUAL_ROW = {
  id: 41,
  chat_id: '971501234567',
  number: '971501234567',
  username: null,
  name: 'Ivan Ivanov',
  email: 'ivan@example.com',
  summary: 'Manual lead created from CRM. Conversation has not started yet.',
  lead_type: 'Villa',
  stage: 'new',
  priority: 'Medium',
  work_type: 'Snagging',
  created_at: new Date('2026-09-03T08:00:00.000Z'),
  updated_at: new Date('2026-09-03T08:00:00.000Z'),
};

const TABLE_WITH_EMAIL = { ...TABLE_LOOKUP_ROW, columns: [...TABLE_LOOKUP_ROW.columns, 'email'] };

describe('POST /api/paterhaus/leads/manual', () => {
  const payload = {
    name: 'Ivan Ivanov',
    phoneNumber: '+971 50 123 4567',
    email: 'ivan@example.com',
    propertyType: 'Villa',
    service: 'Snagging',
  };

  it.each(['info@paterhaus.com', 'r_tszi@paterhaus.com', ' R_TSZI@paterhaus.com '])(
    'allows the allowlisted account %s',
    async (email) => {
      const { repository } = createRepository([[TABLE_WITH_EMAIL], [], [MANUAL_ROW]]);
      const app = await createApp(repository);
      const token = await accessToken(app, email);

      const response = await app.inject({
        method: 'POST',
        url: '/api/paterhaus/leads/manual',
        headers: { authorization: `Bearer ${token}` },
        payload,
      });

      expect(response.statusCode).toBe(201);
    },
  );

  it('rejects unauthenticated requests', async () => {
    const app = await createApp(createRepository([]).repository);
    const response = await app.inject({ method: 'POST', url: '/api/paterhaus/leads/manual', payload });
    expect(response.statusCode).toBe(401);
  });

  it('returns 403 for a valid token whose account is not allowlisted', async () => {
    const { repository, calls } = createRepository([[TABLE_WITH_EMAIL]]);
    const app = await createApp(repository);
    const token = await forgedToken('someone@paterhaus.com');

    const response = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/leads/manual',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(response.statusCode).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('normalizes the phone to digits, writes chat_id = number, stores property type and service, and uses NOW()', async () => {
    const { repository, calls } = createRepository([[TABLE_WITH_EMAIL], [], [MANUAL_ROW]]);
    const app = await createApp(repository);
    const token = await accessToken(app, 'info@paterhaus.com');

    const response = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/leads/manual',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: 41,
      chatId: '971501234567',
      number: '971501234567',
      username: null,
      name: 'Ivan Ivanov',
      email: 'ivan@example.com',
      summary: 'Manual lead created from CRM. Conversation has not started yet.',
      leadType: 'Villa',
      stage: 'new',
      priority: 'Medium',
      workType: 'Snagging',
      createdAt: '2026-09-03T08:00:00.000Z',
      updatedAt: '2026-09-03T08:00:00.000Z',
    });

    const [, update, insert] = calls;
    expect(update?.text).toContain('UPDATE "public"."lead_classifications"');
    expect(update?.text).toContain('WHERE chat_id = $1::text');
    expect(insert?.text).toContain('INSERT INTO "public"."lead_classifications"');
    expect(insert?.text).toContain('NOW(), NOW()');
    expect(insert?.text).toContain('email,');
    expect(insert?.values).toEqual([
      '971501234567',
      '971501234567',
      'Ivan Ivanov',
      'Manual lead created from CRM. Conversation has not started yet.',
      'Villa',
      'Snagging',
      'new',
      'Medium',
      'ivan@example.com',
    ]);
  });

  it.each([
    ['971501234567', '971501234567'],
    ['0501234567', '0501234567'],
    ['+7 (700) 123-45-67', '77001234567'],
  ])('accepts %s and stores %s without inventing a country code', async (input, expected) => {
    const { repository, calls } = createRepository([[TABLE_WITH_EMAIL], [], [{ ...MANUAL_ROW, chat_id: expected, number: expected }]]);
    const app = await createApp(repository);
    const token = await accessToken(app, 'info@paterhaus.com');

    const response = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/leads/manual',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, phoneNumber: input },
    });

    expect(response.statusCode).toBe(201);
    expect(calls[2]?.values?.slice(0, 2)).toEqual([expected, expected]);
  });

  it('stores blank name and email as NULL and omits email when the table lacks the column', async () => {
    const { repository, calls } = createRepository([[TABLE_LOOKUP_ROW], [], [{ ...MANUAL_ROW, name: null, email: undefined }]]);
    const app = await createApp(repository);
    const token = await accessToken(app, 'info@paterhaus.com');

    const response = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/leads/manual',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, name: '   ', email: '' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: null, email: null });
    expect(calls[2]?.values).toHaveLength(8);
    expect(calls[2]?.values?.[2]).toBeNull();
    expect(calls[2]?.text).not.toContain('email');
  });

  it.each([
    ['blank phone', { ...payload, phoneNumber: '   ' }],
    ['non-numeric phone', { ...payload, phoneNumber: 'call me' }],
    ['too short phone', { ...payload, phoneNumber: '12345' }],
    ['invalid email', { ...payload, email: 'not-an-email' }],
    ['legacy identity lead_type', { ...payload, propertyType: 'owner' }],
    ['unknown service', { ...payload, service: 'Cleaning' }],
    ['missing property type', { ...payload, propertyType: undefined }],
  ])('rejects %s with 400 and does not touch the database', async (_label, body) => {
    const { repository, calls } = createRepository([[TABLE_WITH_EMAIL]]);
    const app = await createApp(repository);
    const token = await accessToken(app, 'info@paterhaus.com');

    const response = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/leads/manual',
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    expect(calls.filter((call) => /INSERT|UPDATE/.test(call.text))).toHaveLength(0);
  });

  it('updates the existing row for a duplicate normalized phone instead of inserting', async () => {
    const existing = {
      ...MANUAL_ROW,
      summary: 'Owner of a villa in Palm Jumeirah asking about snagging before handover',
      stage: 'talking',
      priority: 'High',
      updated_at: new Date('2026-09-03T09:30:00.000Z'),
    };
    const { repository, calls } = createRepository([[TABLE_WITH_EMAIL], [existing]]);
    const app = await createApp(repository);
    const token = await accessToken(app, 'r_tszi@paterhaus.com');

    const response = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/leads/manual',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, phoneNumber: '971-50-123-4567' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 41,
      chatId: '971501234567',
      summary: existing.summary,
      stage: 'talking',
      priority: 'High',
      leadType: 'Villa',
      workType: 'Snagging',
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.text).toContain('UPDATE');
    expect(calls[1]?.text).toContain("summary = COALESCE(NULLIF(BTRIM(summary), ''), $4::text)");
    expect(calls[1]?.text).toContain("stage = COALESCE(NULLIF(BTRIM(stage), ''), $7::text)");
    expect(calls[1]?.text).toContain('updated_at = NOW()');
  });

  it('falls back to updating when a concurrent insert wins the unique constraint', async () => {
    let step = 0;
    const repository = new LeadClassificationRepository({
      query: async <Row extends QueryResultRow>() => {
        step += 1;
        if (step === 1) return queryResult([TABLE_WITH_EMAIL] as unknown as Row[]);
        if (step === 2) return queryResult<Row>([]);
        if (step === 3) throw Object.assign(new Error('duplicate key value'), { code: '23505' });
        return queryResult([MANUAL_ROW] as unknown as Row[]);
      },
    });
    const app = await createApp(repository);
    const token = await accessToken(app, 'info@paterhaus.com');

    const response = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/leads/manual',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(step).toBe(4);
  });

  it('returns 503 without leaking driver errors when the write fails', async () => {
    const repository = new LeadClassificationRepository({
      query: async <Row extends QueryResultRow>(text: string) => {
        if (text.includes('information_schema')) return queryResult([TABLE_WITH_EMAIL] as unknown as Row[]);
        throw new Error('relation "pater_classification" does not exist');
      },
    });
    const app = await createApp(repository);
    const token = await accessToken(app, 'info@paterhaus.com');

    const response = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/leads/manual',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('relation');
  });
});

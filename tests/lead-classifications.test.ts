import type { QueryResult, QueryResultRow } from 'pg';
import type { FastifyInstance } from 'fastify';
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

async function accessToken(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/paterhaus/conversations/access-token',
    payload: { email: 'r_tszi@paterhaus.com' },
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
  lead_type: 'owner',
  stage: 'qualified',
  priority: 'high',
  work_type: 'staging',
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

  it('returns classifications sorted by updated_at with mapped fields', async () => {
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
          leadType: 'owner',
          stage: 'qualified',
          priority: 'high',
          workType: 'staging',
          createdAt: '2026-08-20T10:00:00.000Z',
          updatedAt: '2026-08-28T18:00:00.000Z',
          isActive: null,
        },
      ],
    });
    expect(calls[0]?.text).toContain('information_schema.columns');
    expect(calls[1]?.text).toContain('FROM "public"."lead_classifications"');
    expect(calls[1]?.text).toContain('ORDER BY updated_at DESC NULLS LAST, id DESC');
    expect(calls[1]?.text).not.toContain('is_active');
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

import type { QueryResult, QueryResultRow } from 'pg';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import {
  ConversationRepository,
  type ConversationQueryClient,
} from '../src/modules/conversations/conversation.repository.js';

interface QueryCall {
  text: string;
  values: readonly unknown[] | undefined;
}

function queryResult<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function createRepository(responses: QueryResultRow[][]): {
  repository: ConversationRepository;
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
  return { repository: new ConversationRepository({ query }), calls };
}

const apps: FastifyInstance[] = [];
const TEST_CRM_JWT_SECRET = 'test_crm_jwt_secret_value_0123456789';

async function createApp(repository?: ConversationRepository): Promise<FastifyInstance> {
  const app = await buildApp({ conversations: { repository } });
  apps.push(app);
  return app;
}

async function accessToken(app: FastifyInstance, email = ' INFO@PATERHAUS.COM '): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/paterhaus/conversations/access-token',
    payload: { email },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ accessToken: string }>().accessToken;
}

async function signedToken(email: string, expirationTime: string): Promise<string> {
  return new SignJWT({ email, feature: 'paterhaus-conversations' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime(expirationTime)
    .sign(new TextEncoder().encode(TEST_CRM_JWT_SECRET));
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

describe('Paterhaus live conversations API', () => {
  it('issues a short-lived token to a normalized allowlisted email', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/conversations/access-token',
      payload: { email: ' INFO@PATERHAUS.COM ' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      accessToken: expect.any(String),
      expiresIn: 900,
    });
  });

  it('rejects a non-allowlisted email', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/conversations/access-token',
      payload: { email: 'guest@example.com' },
    });

    expect(response.statusCode).toBe(403);
  });

  it.each([
    {},
    { authorization: 'Bearer invalid-token' },
  ])('returns 401 for missing or invalid bearer authentication', async (headers) => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/paterhaus/conversations',
      headers,
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 401 for an expired token', async () => {
    const app = await createApp();
    const token = await signedToken('info@paterhaus.com', '0s');
    const response = await app.inject({
      method: 'GET',
      url: '/api/paterhaus/conversations',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 403 for a valid feature token whose account is not allowlisted', async () => {
    const app = await createApp();
    const token = await signedToken('guest@example.com', '15m');
    const response = await app.inject({
      method: 'GET',
      url: '/api/paterhaus/conversations',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(403);
  });

  it('joins history by chat_id and returns latest-message order', async () => {
    const { repository, calls } = createRepository([
      [
        {
          id: 6,
          chat_id: 'chat-newer',
          number: '77020000001',
          username: null,
          ai_enabled: true,
          latest_message_id: 24,
          latest_message: 'Newest message',
          latest_message_time: '2026-08-28, 23:50:12.438',
          latest_non_ai_username: 'Sultan',
        },
        {
          id: 2,
          chat_id: 'chat-older',
          number: '77020000002',
          username: 'Aruzhan',
          ai_enabled: false,
          latest_message_id: 10,
          latest_message: 'Older message',
          latest_message_time: '2026-08-28, 22:40',
          latest_non_ai_username: 'Aruzhan',
        },
      ],
    ]);
    const app = await createApp(repository);
    const token = await accessToken(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/paterhaus/conversations',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items.map((item: { id: number }) => item.id)).toEqual([6, 2]);
    expect(response.json().items[0]).toMatchObject({
      contactName: 'Sultan',
      lastMessageId: 24,
      lastMessageAt: '2026-08-28T18:50:12.438Z',
    });
    expect(calls[0]?.text).toContain('WHERE h.chat_id = c.chat_id');
    expect(calls[0]?.text).toContain('ORDER BY latest.id DESC NULLS LAST');
  });

  it('loads history through canonical chat_id in ascending ID order and detects AI case-insensitively', async () => {
    const { repository, calls } = createRepository([
      [
        {
          id: 6,
          chat_id: 'canonical-chat-id',
          number: '77021464983',
          username: 'Sultan',
          ai_enabled: true,
          ai_resumed_at: null,
        },
      ],
      [
        {
          id: 23,
          chat_id: 'canonical-chat-id',
          username: 'Sultan',
          message: 'Hello',
          time: '2026-08-28, 23:50:12.438',
        },
        {
          id: 24,
          chat_id: 'canonical-chat-id',
          username: 'aI',
          message: 'Hello! How can I help?',
          time: '2026-08-28, 23:50:14.112',
        },
      ],
    ]);
    const app = await createApp(repository);
    const token = await accessToken(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/paterhaus/conversations/6/messages',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().messages).toEqual([
      expect.objectContaining({ id: 23, senderName: 'Sultan', direction: 'inbound' }),
      expect.objectContaining({
        id: 24,
        senderName: 'AI',
        senderType: 'ai',
        direction: 'outbound',
      }),
    ]);
    expect(calls[1]?.values).toEqual(['canonical-chat-id']);
    expect(calls[1]?.text).toContain('ORDER BY id ASC');
  });

  it('disables AI without changing ai_resumed_at', async () => {
    const resumedAt = new Date('2026-08-28T18:00:00.000Z');
    const { repository, calls } = createRepository([
      [
        {
          id: 6,
          chat_id: 'canonical-chat-id',
          number: '77021464983',
          username: 'Sultan',
          ai_enabled: false,
          ai_resumed_at: resumedAt,
        },
      ],
    ]);
    const app = await createApp(repository);
    const token = await accessToken(app);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/paterhaus/conversations/6/ai',
      headers: { authorization: `Bearer ${token}` },
      payload: { aiEnabled: false },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 6, aiEnabled: false });
    expect(calls[0]?.text).toContain('SET ai_enabled = FALSE');
    expect(calls[0]?.text).not.toContain('NOW()');
  });

  it('enables AI and sets ai_resumed_at with PostgreSQL NOW()', async () => {
    const resumedAt = new Date('2026-08-28T18:00:00.000Z');
    const { repository, calls } = createRepository([
      [
        {
          id: 6,
          chat_id: 'canonical-chat-id',
          number: '77021464983',
          username: 'Sultan',
          ai_enabled: true,
          ai_resumed_at: resumedAt,
        },
      ],
    ]);
    const app = await createApp(repository);
    const token = await accessToken(app);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/paterhaus/conversations/6/ai',
      headers: { authorization: `Bearer ${token}` },
      payload: { aiEnabled: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 6,
      aiEnabled: true,
      aiResumedAt: resumedAt.toISOString(),
    });
    expect(calls[0]?.text).toContain('ai_resumed_at = NOW()');
  });

  it('returns 400 for an invalid AI payload and 404 for a missing conversation', async () => {
    const { repository } = createRepository([[]]);
    const app = await createApp(repository);
    const token = await accessToken(app);

    const invalid = await app.inject({
      method: 'PATCH',
      url: '/api/paterhaus/conversations/6/ai',
      headers: { authorization: `Bearer ${token}` },
      payload: { aiEnabled: 'yes' },
    });
    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/paterhaus/conversations/99/ai',
      headers: { authorization: `Bearer ${token}` },
      payload: { aiEnabled: false },
    });

    expect(invalid.statusCode).toBe(400);
    expect(missing.statusCode).toBe(404);
  });
});

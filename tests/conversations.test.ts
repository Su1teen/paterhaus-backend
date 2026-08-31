import type { QueryResult, QueryResultRow } from 'pg';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import {
  ConversationRepository,
  type ConversationQueryClient,
} from '../src/modules/conversations/conversation.repository.js';
import type {
  OutboundMessageRequest,
  OutboundMessageSender,
} from '../src/modules/conversations/conversation.outbound.js';

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

/** Repository whose external database rejects every query. */
function createFailingRepository(): ConversationRepository {
  return new ConversationRepository({
    query: async () => {
      throw new Error('connection terminated unexpectedly');
    },
  });
}

const apps: FastifyInstance[] = [];
const TEST_CRM_JWT_SECRET = 'test_crm_jwt_secret_value_0123456789';

async function createApp(
  repository?: ConversationRepository,
  outboundSender?: OutboundMessageSender | null,
): Promise<FastifyInstance> {
  const app = await buildApp({ conversations: { repository, outboundSender } });
  apps.push(app);
  return app;
}

function createOutboundSender(behaviour: 'ok' | 'fail' = 'ok'): {
  sender: OutboundMessageSender;
  sent: OutboundMessageRequest[];
} {
  const sent: OutboundMessageRequest[] = [];
  return {
    sent,
    sender: {
      async send(request) {
        if (behaviour === 'fail') throw new Error('waha unreachable');
        sent.push(request);
      },
    },
  };
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

  it('reports an external database failure instead of an empty history', async () => {
    const app = await createApp(createFailingRepository());
    const token = await accessToken(app);

    const list = await app.inject({
      method: 'GET',
      url: '/api/paterhaus/conversations',
      headers: { authorization: `Bearer ${token}` },
    });
    const history = await app.inject({
      method: 'GET',
      url: '/api/paterhaus/conversations/6/messages',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(list.statusCode).toBe(503);
    expect(history.statusCode).toBe(503);
    expect(history.json().messages).toBeUndefined();
    expect(history.body).not.toContain('connection terminated');
  });

  it('returns an empty history for a conversation without messages', async () => {
    const { repository } = createRepository([
      [{ id: 6, chat_id: 'canonical-chat-id', number: '7702', username: 'Sultan', ai_enabled: true }],
      [],
    ]);
    const app = await createApp(repository);
    const token = await accessToken(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/paterhaus/conversations/6/messages',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().messages).toEqual([]);
  });

  it('reports manual reply support from the configured outbound integration', async () => {
    const withoutSender = await createApp(undefined, null);
    const unsupported = await withoutSender.inject({
      method: 'GET',
      url: '/api/paterhaus/conversations/capabilities',
      headers: { authorization: `Bearer ${await accessToken(withoutSender)}` },
    });

    const withSender = await createApp(undefined, createOutboundSender().sender);
    const supported = await withSender.inject({
      method: 'GET',
      url: '/api/paterhaus/conversations/capabilities',
      headers: { authorization: `Bearer ${await accessToken(withSender)}` },
    });

    expect(unsupported.json()).toMatchObject({ manualMessages: false, attachments: false });
    expect(supported.json()).toMatchObject({ manualMessages: true, attachments: false });
  });

  it('sends a human takeover reply and stores it as human:<email>', async () => {
    const { repository, calls } = createRepository([
      [{ id: 6, chat_id: 'canonical-chat-id', number: '77021464983', username: 'Sultan', ai_enabled: false }],
      [
        {
          id: 25,
          chat_id: 'canonical-chat-id',
          username: 'human:info@paterhaus.com',
          message: 'Hello from the manager',
          time: '2026-08-29, 10:00:00.000',
        },
      ],
    ]);
    const outbound = createOutboundSender();
    const app = await createApp(repository, outbound.sender);
    const token = await accessToken(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/conversations/6/messages',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'send-key-000001' },
      payload: { text: 'Hello from the manager' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().message).toMatchObject({
      id: 25,
      senderType: 'human',
      senderName: 'info@paterhaus.com',
      direction: 'outbound',
    });
    expect(outbound.sent).toEqual([
      expect.objectContaining({
        chatId: 'canonical-chat-id',
        authorizedEmail: 'info@paterhaus.com',
        idempotencyKey: 'send-key-000001',
      }),
    ]);
    expect(calls[1]?.text).toContain('INSERT INTO hostory_pater');
    expect(calls[1]?.values?.[1]).toBe('human:info@paterhaus.com');
  });

  it('rejects a manual reply while AI is still active', async () => {
    const { repository, calls } = createRepository([
      [{ id: 6, chat_id: 'canonical-chat-id', number: '7702', username: 'Sultan', ai_enabled: true }],
    ]);
    const outbound = createOutboundSender();
    const app = await createApp(repository, outbound.sender);
    const token = await accessToken(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/conversations/6/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { text: 'Hello' },
    });

    expect(response.statusCode).toBe(409);
    expect(outbound.sent).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('rejects malformed manual replies and unknown conversations', async () => {
    const { repository } = createRepository([[]]);
    const app = await createApp(repository, createOutboundSender().sender);
    const token = await accessToken(app);

    const empty = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/conversations/6/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { text: '   ' },
    });
    const missing = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/conversations/99/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { text: 'Hello' },
    });
    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/conversations/6/messages',
      payload: { text: 'Hello' },
    });

    expect(empty.statusCode).toBe(400);
    expect(missing.statusCode).toBe(404);
    expect(unauthenticated.statusCode).toBe(401);
  });

  it('does not persist history when the outbound integration fails', async () => {
    const { repository, calls } = createRepository([
      [{ id: 6, chat_id: 'canonical-chat-id', number: '7702', username: 'Sultan', ai_enabled: false }],
    ]);
    const app = await createApp(repository, createOutboundSender('fail').sender);
    const token = await accessToken(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/conversations/6/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { text: 'Hello' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('waha');
    expect(calls.some((call) => call.text.includes('INSERT INTO hostory_pater'))).toBe(false);
  });

  it('reports manual replies as unavailable when no outbound integration is configured', async () => {
    const { repository } = createRepository([
      [{ id: 6, chat_id: 'canonical-chat-id', number: '7702', username: 'Sultan', ai_enabled: false }],
    ]);
    const app = await createApp(repository, null);
    const token = await accessToken(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/conversations/6/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { text: 'Hello' },
    });

    expect(response.statusCode).toBe(503);
  });

  it('sends only once for a repeated idempotency key', async () => {
    const conversationRow = {
      id: 6,
      chat_id: 'canonical-chat-id',
      number: '7702',
      username: 'Sultan',
      ai_enabled: false,
    };
    const insertedRow = {
      id: 25,
      chat_id: 'canonical-chat-id',
      username: 'human:info@paterhaus.com',
      message: 'Hello',
      time: '2026-08-29, 10:00:00.000',
    };
    const { repository } = createRepository([
      [conversationRow],
      [insertedRow],
      [conversationRow],
      [insertedRow],
    ]);
    const outbound = createOutboundSender();
    const app = await createApp(repository, outbound.sender);
    const token = await accessToken(app);

    const send = async () =>
      app.inject({
        method: 'POST',
        url: '/api/paterhaus/conversations/6/messages',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'repeated-key-1' },
        payload: { text: 'Hello' },
      });

    const first = await send();
    const second = await send();

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().message.id).toBe(25);
    expect(outbound.sent).toHaveLength(1);
  });
});

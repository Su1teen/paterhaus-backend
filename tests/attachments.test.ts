import type { FastifyInstance } from 'fastify';
import type { QueryResult, QueryResultRow } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import {
  AttachmentRepository,
  type AttachmentQueryClient,
} from '../src/modules/attachments/attachment.repository.js';
import type { AttachmentDownloadSigner } from '../src/modules/attachments/attachment.storage.js';
import {
  ConversationRepository,
  type ConversationQueryClient,
} from '../src/modules/conversations/conversation.repository.js';

interface QueryCall {
  text: string;
  values: readonly unknown[] | undefined;
}

function result<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return { command: 'SELECT', rowCount: rows.length, oid: 0, fields: [], rows };
}

function attachmentRepository(responses: QueryResultRow[][]) {
  const calls: QueryCall[] = [];
  const query: AttachmentQueryClient['query'] = async <Row extends QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ) => {
    calls.push({ text, values });
    return result((responses.shift() ?? []) as Row[]);
  };
  return { repository: new AttachmentRepository({ query }), calls };
}

function conversationRepository(responses: QueryResultRow[][]) {
  const calls: QueryCall[] = [];
  const query: ConversationQueryClient['query'] = async <Row extends QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ) => {
    calls.push({ text, values });
    return result((responses.shift() ?? []) as Row[]);
  };
  return { repository: new ConversationRepository({ query }), calls };
}

const baseAttachment = {
  id: '91',
  chat_id: 'canonical-chat',
  history_id: '24',
  sender_type: 'contact',
  sender_name: 'Sultan',
  number: '77021464983',
  file_name: 'Letter of Intent.docx',
  mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  file_kind: 'word',
  size_bytes: '42905',
  storage_bucket: 'pater-media',
  storage_key: 'default/abc/document.docx',
  caption: null,
  summary: 'Letter of intent regarding a pilot implementation.',
  created_at: new Date('2026-09-22T10:00:00.000Z'),
};

const apps: FastifyInstance[] = [];

async function token(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/paterhaus/conversations/access-token',
    payload: { email: 'r_tszi@paterhaus.com' },
  });
  return response.json<{ accessToken: string }>().accessToken;
}

async function appFor(options: {
  attachments: AttachmentRepository;
  conversations?: ConversationRepository;
  signer?: AttachmentDownloadSigner | null;
  bucket?: string;
}) {
  const app = await buildApp({
    conversations: { attachmentRepository: null, outboundSender: null },
    attachments: {
      repository: options.attachments,
      conversations: options.conversations,
      signer: options.signer,
      configuredBucket: options.bucket,
    },
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Paterhaus attachment API', () => {
  it('lists conversation attachments by the conversation canonical chat_id', async () => {
    const conversations = conversationRepository([
      [{ id: 6, chat_id: 'canonical-chat', number: '7702', username: 'Sultan', ai_enabled: true }],
    ]);
    const attachments = attachmentRepository([[baseAttachment]]);
    const app = await appFor({
      attachments: attachments.repository,
      conversations: conversations.repository,
      signer: null,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/paterhaus/conversations/6/attachments',
      headers: { authorization: `Bearer ${await token(app)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({
      id: '91',
      chatId: 'canonical-chat',
      fileName: 'Letter of Intent.docx',
      kind: 'word',
      sizeBytes: 42905,
    });
    expect(attachments.calls[0]?.values).toEqual(['canonical-chat']);
    expect(response.body).not.toContain('storage_key');
    expect(response.body).not.toContain('extracted_text');
  });

  it('lists global files newest-first with search, kind and cursor filters', async () => {
    const attachments = attachmentRepository([[baseAttachment, { ...baseAttachment, id: '90' }]]);
    const app = await appFor({ attachments: attachments.repository, signer: null });
    const response = await app.inject({
      method: 'GET',
      url: '/api/paterhaus/files?limit=1&cursor=10&search=Letter&kind=word',
      headers: { authorization: `Bearer ${await token(app)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ nextCursor: '11' });
    expect(response.json().items).toHaveLength(1);
    expect(attachments.calls[0]?.text).toContain('ORDER BY created_at DESC, id DESC');
    expect(attachments.calls[0]?.values).toEqual(['%Letter%', 'word', 2, 10]);
  });

  it('requires live Paterhaus authorization', async () => {
    const attachments = attachmentRepository([[]]);
    const app = await appFor({ attachments: attachments.repository, signer: null });
    const response = await app.inject({ method: 'GET', url: '/api/paterhaus/files' });
    expect(response.statusCode).toBe(401);
    expect(attachments.calls).toHaveLength(0);
  });

  it('signs a five-minute URL without returning storage details', async () => {
    const attachments = attachmentRepository([[baseAttachment]]);
    const sign = vi.fn(async () => 'https://signed.example/object?expires=300');
    const app = await appFor({
      attachments: attachments.repository,
      signer: { sign },
      bucket: 'pater-media',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/attachments/91/download-url',
      headers: { authorization: `Bearer ${await token(app)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      url: 'https://signed.example/object?expires=300',
      expiresIn: 300,
    });
    expect(sign).toHaveBeenCalledWith({
      bucket: 'pater-media',
      key: 'default/abc/document.docx',
      fileName: 'Letter of Intent.docx',
    });
  });

  it('returns 404 for a missing attachment', async () => {
    const attachments = attachmentRepository([[]]);
    const app = await appFor({
      attachments: attachments.repository,
      signer: { sign: vi.fn() },
      bucket: 'pater-media',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/attachments/999/download-url',
      headers: { authorization: `Bearer ${await token(app)}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it('returns a safe 503 when S3 is not configured', async () => {
    const attachments = attachmentRepository([[baseAttachment]]);
    const app = await appFor({ attachments: attachments.repository, signer: null });
    const response = await app.inject({
      method: 'POST',
      url: '/api/paterhaus/attachments/91/download-url',
      headers: { authorization: `Bearer ${await token(app)}` },
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('storage_key');
  });
});

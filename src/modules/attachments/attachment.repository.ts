import type { QueryResult, QueryResultRow } from 'pg';
import { getChatHistoryPool } from '../../lib/chat-history-db.js';
import type { AttachmentKind } from './attachment.schemas.js';

export interface AttachmentQueryClient {
  query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
}

export class AttachmentDataUnavailableError extends Error {
  constructor(readonly operation: string) {
    super(`Attachment database operation failed: ${operation}`);
    this.name = 'AttachmentDataUnavailableError';
  }
}

export interface AttachmentRow extends QueryResultRow {
  id: string;
  chat_id: string;
  history_id: string | null;
  sender_type: string;
  sender_name: string | null;
  number: string | null;
  file_name: string;
  mime_type: string | null;
  file_kind: AttachmentKind;
  size_bytes: string | null;
  storage_bucket: string;
  storage_key: string;
  caption: string | null;
  summary: string | null;
  created_at: Date | string;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export class AttachmentRepository {
  constructor(private readonly client: AttachmentQueryClient = getChatHistoryPool()) {}

  private async run<Row extends QueryResultRow>(
    operation: string,
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>> {
    try {
      return await this.client.query<Row>(text, values);
    } catch {
      throw new AttachmentDataUnavailableError(operation);
    }
  }

  async listByChatId(chatId: string): Promise<AttachmentRow[]> {
    const result = await this.run<AttachmentRow>(
      'list conversation attachments',
      `
        SELECT id, chat_id, history_id, sender_type, sender_name, number, file_name, mime_type,
               file_kind, size_bytes, storage_bucket, storage_key, caption, summary, created_at
        FROM pater_attachments
        WHERE chat_id = $1
        ORDER BY created_at ASC, id ASC
      `,
      [chatId],
    );
    return result.rows;
  }

  async listByHistoryIds(historyIds: number[]): Promise<AttachmentRow[]> {
    if (historyIds.length === 0) return [];
    const result = await this.run<AttachmentRow>(
      'list message attachments',
      `
        SELECT id, chat_id, history_id, sender_type, sender_name, number, file_name, mime_type,
               file_kind, size_bytes, storage_bucket, storage_key, caption, summary, created_at
        FROM pater_attachments
        WHERE history_id = ANY($1::bigint[])
        ORDER BY created_at ASC, id ASC
      `,
      [historyIds],
    );
    return result.rows;
  }

  async listFiles(input: {
    limit: number;
    offset: number;
    search?: string;
    kind?: AttachmentKind;
  }): Promise<{ rows: AttachmentRow[]; hasMore: boolean }> {
    const searchPattern = input.search ? `%${escapeLikePattern(input.search)}%` : null;
    const result = await this.run<AttachmentRow>(
      'list files',
      `
        SELECT id, chat_id, history_id, sender_type, sender_name, number, file_name, mime_type,
               file_kind, size_bytes, storage_bucket, storage_key, caption, summary, created_at
        FROM pater_attachments
        WHERE (
          $1::text IS NULL
          OR file_name ILIKE $1 ESCAPE '\\'
          OR COALESCE(sender_name, '') ILIKE $1 ESCAPE '\\'
          OR COALESCE(number, '') ILIKE $1 ESCAPE '\\'
          OR COALESCE(summary, '') ILIKE $1 ESCAPE '\\'
          OR chat_id ILIKE $1 ESCAPE '\\'
        )
          AND (
            $2::text IS NULL
            OR file_kind = $2
            OR ($2 = 'other' AND file_kind = 'text')
          )
        ORDER BY created_at DESC, id DESC
        LIMIT $3
        OFFSET $4
      `,
      [searchPattern, input.kind ?? null, input.limit + 1, input.offset],
    );
    return { rows: result.rows.slice(0, input.limit), hasMore: result.rows.length > input.limit };
  }

  async findById(id: string): Promise<AttachmentRow | null> {
    const result = await this.run<AttachmentRow>(
      'find attachment',
      `
        SELECT id, chat_id, history_id, sender_type, sender_name, number, file_name, mime_type,
               file_kind, size_bytes, storage_bucket, storage_key, caption, summary, created_at
        FROM pater_attachments
        WHERE id = $1
      `,
      [id],
    );
    return result.rows[0] ?? null;
  }
}

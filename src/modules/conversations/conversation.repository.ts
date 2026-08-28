import type { QueryResult, QueryResultRow } from 'pg';
import { getChatHistoryPool } from '../../lib/chat-history-db.js';

export interface ConversationQueryClient {
  query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
}

interface ConversationListRow extends QueryResultRow {
  id: number;
  chat_id: string | null;
  number: string | null;
  username: string | null;
  ai_enabled: boolean | null;
  latest_message_id: number | null;
  latest_message: string | null;
  latest_message_time: string | null;
  latest_non_ai_username: string | null;
}

interface ConversationRow extends QueryResultRow {
  id: number;
  chat_id: string | null;
  number: string | null;
  username: string | null;
  ai_enabled: boolean | null;
  ai_resumed_at: Date | string | null;
}

interface ConversationAiRow extends QueryResultRow {
  id: number;
  chat_id: string | null;
  ai_enabled: boolean | null;
  ai_resumed_at: Date | string | null;
}

interface MessageRow extends QueryResultRow {
  id: number;
  chat_id: string | null;
  username: string | null;
  message: string | null;
  time: string | null;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export class ConversationRepository {
  constructor(private readonly client: ConversationQueryClient = getChatHistoryPool()) {}

  async list(input: {
    limit: number;
    offset: number;
    search?: string;
  }): Promise<{ rows: ConversationListRow[]; hasMore: boolean }> {
    const searchPattern = input.search ? `%${escapeLikePattern(input.search)}%` : null;
    const result = await this.client.query<ConversationListRow>(
      `
        SELECT
          c.id,
          c.chat_id,
          c.number,
          c.username,
          COALESCE(c.ai_enabled, TRUE) AS ai_enabled,
          latest.id AS latest_message_id,
          latest.message AS latest_message,
          latest.time AS latest_message_time,
          contact.username AS latest_non_ai_username
        FROM chats_pater c
        LEFT JOIN LATERAL (
          SELECT h.id, h.message, h.time
          FROM hostory_pater h
          WHERE h.chat_id = c.chat_id
          ORDER BY h.id DESC
          LIMIT 1
        ) latest ON TRUE
        LEFT JOIN LATERAL (
          SELECT h.username
          FROM hostory_pater h
          WHERE h.chat_id = c.chat_id
            AND LOWER(COALESCE(h.username, '')) <> 'ai'
            AND NULLIF(BTRIM(h.username), '') IS NOT NULL
          ORDER BY h.id DESC
          LIMIT 1
        ) contact ON TRUE
        WHERE (
          $1::text IS NULL
          OR COALESCE(c.chat_id, '') ILIKE $1 ESCAPE '\\'
          OR COALESCE(c.number, '') ILIKE $1 ESCAPE '\\'
          OR COALESCE(c.username, '') ILIKE $1 ESCAPE '\\'
        )
        ORDER BY latest.id DESC NULLS LAST, c.id DESC
        LIMIT $2
        OFFSET $3
      `,
      [searchPattern, input.limit + 1, input.offset],
    );

    return {
      rows: result.rows.slice(0, input.limit),
      hasMore: result.rows.length > input.limit,
    };
  }

  async findById(id: number): Promise<ConversationRow | null> {
    const result = await this.client.query<ConversationRow>(
      `
        SELECT id, chat_id, number, username, COALESCE(ai_enabled, TRUE) AS ai_enabled, ai_resumed_at
        FROM chats_pater
        WHERE id = $1
      `,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listMessages(chatId: string): Promise<MessageRow[]> {
    const result = await this.client.query<MessageRow>(
      `
        SELECT id, chat_id, username, message, time
        FROM hostory_pater
        WHERE chat_id = $1
        ORDER BY id ASC
      `,
      [chatId],
    );
    return result.rows;
  }

  async setAiEnabled(id: number, aiEnabled: boolean): Promise<ConversationAiRow | null> {
    const result = aiEnabled
      ? await this.client.query<ConversationAiRow>(
          `
            UPDATE chats_pater
            SET ai_enabled = TRUE, ai_resumed_at = NOW()
            WHERE id = $1
            RETURNING id, chat_id, ai_enabled, ai_resumed_at
          `,
          [id],
        )
      : await this.client.query<ConversationAiRow>(
          `
            UPDATE chats_pater
            SET ai_enabled = FALSE
            WHERE id = $1
            RETURNING id, chat_id, ai_enabled, ai_resumed_at
          `,
          [id],
        );
    return result.rows[0] ?? null;
  }
}

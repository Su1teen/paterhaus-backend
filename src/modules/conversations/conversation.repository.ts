import type { QueryResult, QueryResultRow } from 'pg';
import { getChatHistoryPool } from '../../lib/chat-history-db.js';

export interface ConversationQueryClient {
  query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
}

/**
 * Raised when the external chat-history database is unreachable or rejects a
 * query. It exists so a read failure can never be mistaken for empty history.
 */
export class ChatHistoryUnavailableError extends Error {
  constructor(readonly operation: string) {
    super(`Chat history database operation failed: ${operation}`);
    this.name = 'ChatHistoryUnavailableError';
  }
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

export interface MessageRow extends QueryResultRow {
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

  private async run<Row extends QueryResultRow>(
    operation: string,
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>> {
    try {
      return await this.client.query<Row>(text, values);
    } catch {
      // The driver message can contain connection details; it is never surfaced.
      throw new ChatHistoryUnavailableError(operation);
    }
  }

  async list(input: {
    limit: number;
    offset: number;
    search?: string;
  }): Promise<{ rows: ConversationListRow[]; hasMore: boolean }> {
    const searchPattern = input.search ? `%${escapeLikePattern(input.search)}%` : null;
    const result = await this.run<ConversationListRow>(
      'list conversations',
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
    const result = await this.run<ConversationRow>(
      'find conversation',
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
    const result = await this.run<MessageRow>(
      'list messages',
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

  /**
   * Appends an outbound human message to the history table. Called only after
   * the downstream integration confirmed delivery.
   */
  async insertHumanMessage(input: {
    chatId: string;
    username: string;
    text: string;
    time: string;
  }): Promise<MessageRow> {
    const result = await this.run<MessageRow>(
      'insert human message',
      `
        INSERT INTO hostory_pater (chat_id, username, message, time)
        VALUES ($1, $2, $3, $4)
        RETURNING id, chat_id, username, message, time
      `,
      [input.chatId, input.username, input.text, input.time],
    );

    const row = result.rows[0];
    if (!row) throw new ChatHistoryUnavailableError('insert human message');
    return row;
  }

  async setAiEnabled(id: number, aiEnabled: boolean): Promise<ConversationAiRow | null> {
    const result = aiEnabled
      ? await this.run<ConversationAiRow>(
          'resume ai',
          `
            UPDATE chats_pater
            SET ai_enabled = TRUE, ai_resumed_at = NOW()
            WHERE id = $1
            RETURNING id, chat_id, ai_enabled, ai_resumed_at
          `,
          [id],
        )
      : await this.run<ConversationAiRow>(
          'disable ai',
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

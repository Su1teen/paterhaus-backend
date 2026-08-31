import type { QueryResultRow } from 'pg';
import { getChatHistoryPool } from '../../lib/chat-history-db.js';
import { getEnv } from '../../config/env.js';
import type { ConversationQueryClient } from '../conversations/conversation.repository.js';

/** Columns that identify the AI lead-classification table produced by n8n. */
const SIGNATURE_COLUMNS = ['chat_id', 'lead_type', 'stage', 'priority', 'work_type', 'summary'];
const SELECTABLE_OPTIONAL_COLUMNS = ['is_active'];
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*$/;

export class LeadClassificationsUnavailableError extends Error {
  constructor(readonly reason: 'table-not-found' | 'query-failed') {
    super(`Lead classifications unavailable: ${reason}`);
    this.name = 'LeadClassificationsUnavailableError';
  }
}

export interface LeadClassificationRow extends QueryResultRow {
  id: number;
  chat_id: string | null;
  number: string | null;
  username: string | null;
  name: string | null;
  summary: string | null;
  lead_type: string | null;
  stage: string | null;
  priority: string | null;
  work_type: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  is_active?: boolean | null;
}

export interface ClassificationTable {
  schema: string;
  table: string;
  /** Optional columns that exist in the deployed table (e.g. `is_active`). */
  optionalColumns: ReadonlySet<string>;
}

interface TableLookupRow extends QueryResultRow {
  table_schema: string;
  table_name: string;
  columns: string[];
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new LeadClassificationsUnavailableError('table-not-found');
  }
  return `"${value}"`;
}

/**
 * Reads AI lead classifications from the chat-history database. The table name is
 * not fixed across deployments, so it is resolved from its column signature (or
 * from `LEAD_CLASSIFICATIONS_TABLE`) once per process.
 */
export class LeadClassificationRepository {
  private resolved: ClassificationTable | null = null;

  constructor(private readonly client: ConversationQueryClient = getChatHistoryPool()) {}

  async resolveTable(): Promise<ClassificationTable> {
    if (this.resolved) return this.resolved;

    const configuredTable = getEnv().LEAD_CLASSIFICATIONS_TABLE;
    let rows: TableLookupRow[];
    try {
      const result = await this.client.query<TableLookupRow>(
        `
          SELECT table_schema, table_name, ARRAY_AGG(DISTINCT column_name) AS columns
          FROM information_schema.columns
          WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
            AND ($1::text IS NULL OR table_name = $1)
          GROUP BY table_schema, table_name
          HAVING COUNT(DISTINCT column_name) FILTER (WHERE column_name = ANY($2::text[])) = $3
          ORDER BY table_schema, table_name
          LIMIT 1
        `,
        [configuredTable || null, SIGNATURE_COLUMNS, SIGNATURE_COLUMNS.length],
      );
      rows = result.rows;
    } catch {
      throw new LeadClassificationsUnavailableError('query-failed');
    }

    const row = rows[0];
    if (!row) throw new LeadClassificationsUnavailableError('table-not-found');

    this.resolved = {
      schema: row.table_schema,
      table: row.table_name,
      optionalColumns: new Set(
        SELECTABLE_OPTIONAL_COLUMNS.filter((column) => row.columns.includes(column)),
      ),
    };
    return this.resolved;
  }

  async list(input: {
    limit: number;
    offset: number;
  }): Promise<{ rows: LeadClassificationRow[]; hasMore: boolean; table: ClassificationTable }> {
    const table = await this.resolveTable();
    const qualifiedName = `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.table)}`;
    const hasIsActive = table.optionalColumns.has('is_active');

    try {
      const result = await this.client.query<LeadClassificationRow>(
        `
          SELECT
            id, chat_id, number, username, name, summary,
            lead_type, stage, priority, work_type, created_at, updated_at
            ${hasIsActive ? ', is_active' : ''}
          FROM ${qualifiedName}
          ${hasIsActive ? 'WHERE COALESCE(is_active, TRUE)' : ''}
          ORDER BY updated_at DESC NULLS LAST, id DESC
          LIMIT $1
          OFFSET $2
        `,
        [input.limit + 1, input.offset],
      );

      return {
        rows: result.rows.slice(0, input.limit),
        hasMore: result.rows.length > input.limit,
        table,
      };
    } catch {
      throw new LeadClassificationsUnavailableError('query-failed');
    }
  }
}

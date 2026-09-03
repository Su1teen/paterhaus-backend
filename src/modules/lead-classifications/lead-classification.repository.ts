import type { QueryResultRow } from 'pg';
import { getChatHistoryPool } from '../../lib/chat-history-db.js';
import { getEnv } from '../../config/env.js';
import type { ConversationQueryClient } from '../conversations/conversation.repository.js';

/** Columns that identify the AI lead-classification table (`pater_classification`) produced by n8n. */
const SIGNATURE_COLUMNS = ['chat_id', 'lead_type', 'stage', 'priority', 'work_type', 'summary'];
const SELECTABLE_OPTIONAL_COLUMNS = ['is_active', 'email'];
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/**
 * Owner Pipeline order: Urgent → High → Medium → Low → anything else, then most
 * recently updated first.
 */
const PRIORITY_ORDER_SQL = `
  CASE LOWER(BTRIM(COALESCE(priority, '')))
    WHEN 'urgent' THEN 0
    WHEN 'high' THEN 1
    WHEN 'medium' THEN 2
    WHEN 'low' THEN 3
    ELSE 4
  END`;

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
  email?: string | null;
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
  /** Optional columns that exist in the deployed table (e.g. `is_active`, `email`). */
  optionalColumns: ReadonlySet<string>;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

export interface ManualLeadUpsertInput {
  chatId: string;
  number: string;
  name: string | null;
  email: string | null;
  summary: string;
  leadType: string;
  workType: string;
  defaultStage: string;
  defaultPriority: string;
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
 * Reads and writes AI lead classifications in the chat-history database. The table
 * name is not fixed across deployments, so it is resolved from its column signature
 * (or from `LEAD_CLASSIFICATIONS_TABLE`) once per process.
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

  private qualifiedName(table: ClassificationTable): string {
    return `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.table)}`;
  }

  private selectColumns(table: ClassificationTable): string {
    const hasIsActive = table.optionalColumns.has('is_active');
    const hasEmail = table.optionalColumns.has('email');
    return `
            id, chat_id, number, username, name, summary,
            lead_type, stage, priority, work_type, created_at, updated_at
            ${hasEmail ? ', email' : ''}
            ${hasIsActive ? ', is_active' : ''}`;
  }

  async list(input: {
    limit: number;
    offset: number;
  }): Promise<{ rows: LeadClassificationRow[]; hasMore: boolean; table: ClassificationTable }> {
    const table = await this.resolveTable();
    const hasIsActive = table.optionalColumns.has('is_active');

    try {
      const result = await this.client.query<LeadClassificationRow>(
        `
          SELECT ${this.selectColumns(table)}
          FROM ${this.qualifiedName(table)}
          ${hasIsActive ? 'WHERE COALESCE(is_active, TRUE)' : ''}
          ORDER BY ${PRIORITY_ORDER_SQL}, updated_at DESC NULLS LAST, id DESC
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

  /**
   * Creates or updates a manually entered lead keyed by `chat_id`. An existing row keeps
   * its richer conversation summary, stage and priority; only blanks are filled in.
   * Timestamps always come from database `NOW()`.
   */
  async upsertManual(
    input: ManualLeadUpsertInput,
  ): Promise<{ row: LeadClassificationRow; created: boolean; table: ClassificationTable }> {
    const table = await this.resolveTable();
    const hasEmail = table.optionalColumns.has('email');
    const qualifiedName = this.qualifiedName(table);
    const returning = this.selectColumns(table);

    // `email` is bound only when the deployed table has the column, so the
    // parameter list must match the statement exactly.
    const values: unknown[] = [
      input.chatId,
      input.number,
      input.name,
      input.summary,
      input.leadType,
      input.workType,
      input.defaultStage,
      input.defaultPriority,
    ];
    if (hasEmail) values.push(input.email);
    const emailParam = '$9::text';

    const updateSql = `
          UPDATE ${qualifiedName}
          SET
            number = COALESCE(NULLIF(BTRIM(number), ''), $2::text),
            name = COALESCE(NULLIF($3::text, ''), name),
            summary = COALESCE(NULLIF(BTRIM(summary), ''), $4::text),
            lead_type = $5::text,
            work_type = $6::text,
            stage = COALESCE(NULLIF(BTRIM(stage), ''), $7::text),
            priority = COALESCE(NULLIF(BTRIM(priority), ''), $8::text),
            ${hasEmail ? `email = COALESCE(NULLIF(${emailParam}, ''), email),` : ''}
            updated_at = NOW()
          WHERE chat_id = $1::text
          RETURNING ${returning}`;

    const insertSql = `
          INSERT INTO ${qualifiedName} (
            chat_id, number, username, name, summary, lead_type, work_type, stage, priority,
            ${hasEmail ? 'email,' : ''} created_at, updated_at
          )
          VALUES ($1::text, $2::text, NULL, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text,
            ${hasEmail ? `${emailParam},` : ''} NOW(), NOW())
          RETURNING ${returning}`;

    try {
      const updated = await this.client.query<LeadClassificationRow>(updateSql, values);
      const existing = updated.rows[0];
      if (existing) return { row: existing, created: false, table };

      try {
        const inserted = await this.client.query<LeadClassificationRow>(insertSql, values);
        const row = inserted.rows[0];
        if (!row) throw new Error('insert returned no row');
        return { row, created: true, table };
      } catch (error) {
        // A concurrent insert for the same chat_id hit the unique constraint; the
        // row now exists, so apply the update instead of failing the request.
        if (!isUniqueViolation(error)) throw error;
        const retried = await this.client.query<LeadClassificationRow>(updateSql, values);
        const row = retried.rows[0];
        if (!row) throw error;
        return { row, created: false, table };
      }
    } catch {
      throw new LeadClassificationsUnavailableError('query-failed');
    }
  }
}

import { serviceUnavailable } from '../../plugins/error-handler.js';
import {
  LeadClassificationRepository,
  LeadClassificationsUnavailableError,
  type LeadClassificationRow,
} from './lead-classification.repository.js';
import type { LeadClassificationListQuery } from './lead-classification.schemas.js';

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function asIso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapRow(row: LeadClassificationRow) {
  const name = clean(row.name);
  const username = clean(row.username);

  return {
    id: row.id,
    chatId: clean(row.chat_id),
    number: clean(row.number),
    username,
    name,
    displayName: name ?? username ?? clean(row.number) ?? clean(row.chat_id) ?? `Lead ${row.id}`,
    summary: clean(row.summary),
    leadType: clean(row.lead_type),
    stage: clean(row.stage),
    priority: clean(row.priority),
    workType: clean(row.work_type),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    isActive: row.is_active === undefined ? null : row.is_active !== false,
  };
}

export class LeadClassificationService {
  constructor(private readonly repository = new LeadClassificationRepository()) {}

  async list(query: LeadClassificationListQuery) {
    const offset = query.cursor ?? 0;

    try {
      const result = await this.repository.list({ limit: query.limit, offset });
      return {
        items: result.rows.map(mapRow),
        nextCursor: result.hasMore ? String(offset + query.limit) : null,
        /** Lets the UI hide close/archive affordances the schema cannot support. */
        supportsArchive: result.table.optionalColumns.has('is_active'),
      };
    } catch (error) {
      if (error instanceof LeadClassificationsUnavailableError) {
        throw serviceUnavailable('Live lead classifications are temporarily unavailable.');
      }
      throw error;
    }
  }
}

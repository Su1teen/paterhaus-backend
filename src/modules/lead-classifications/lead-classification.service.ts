import { forbidden, serviceUnavailable } from '../../plugins/error-handler.js';
import {
  LeadClassificationRepository,
  LeadClassificationsUnavailableError,
  type LeadClassificationRow,
} from './lead-classification.repository.js';
import {
  MANUAL_LEAD_ALLOWED_EMAILS,
  MANUAL_LEAD_DEFAULT_PRIORITY,
  MANUAL_LEAD_DEFAULT_STAGE,
  MANUAL_LEAD_SUMMARY,
  type LeadClassificationListQuery,
  type ManualLeadRequest,
} from './lead-classification.schemas.js';

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function asIso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function mapClassificationRow(row: LeadClassificationRow) {
  const name = clean(row.name);
  const username = clean(row.username);

  return {
    id: row.id,
    chatId: clean(row.chat_id),
    number: clean(row.number),
    username,
    name,
    email: clean(row.email),
    displayName: name ?? username ?? clean(row.number) ?? clean(row.chat_id) ?? 'Unnamed lead',
    summary: clean(row.summary),
    /** Property type: Apartment, Villa, Townhouse, Studio or Other. */
    leadType: clean(row.lead_type),
    stage: clean(row.stage),
    priority: clean(row.priority),
    workType: clean(row.work_type),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    isActive: row.is_active === undefined ? null : row.is_active !== false,
  };
}

export function isManualLeadAllowedEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && MANUAL_LEAD_ALLOWED_EMAILS.has(email.trim().toLowerCase());
}

export class LeadClassificationService {
  constructor(private readonly repository = new LeadClassificationRepository()) {}

  async list(query: LeadClassificationListQuery) {
    const offset = query.cursor ?? 0;

    try {
      const result = await this.repository.list({ limit: query.limit, offset });
      return {
        items: result.rows.map(mapClassificationRow),
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

  async createManual(input: ManualLeadRequest, authorizedEmail: string) {
    if (!isManualLeadAllowedEmail(authorizedEmail)) {
      throw forbidden('Account is not allowed to create leads');
    }

    try {
      const result = await this.repository.upsertManual({
        chatId: input.phoneNumber,
        number: input.phoneNumber,
        name: input.name,
        email: input.email,
        summary: MANUAL_LEAD_SUMMARY,
        leadType: input.propertyType,
        workType: input.service,
        defaultStage: MANUAL_LEAD_DEFAULT_STAGE,
        defaultPriority: MANUAL_LEAD_DEFAULT_PRIORITY,
      });
      return { lead: mapClassificationRow(result.row), created: result.created };
    } catch (error) {
      if (error instanceof LeadClassificationsUnavailableError) {
        throw serviceUnavailable('Lead could not be saved right now. Please try again.');
      }
      throw error;
    }
  }
}

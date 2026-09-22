import { notFound, serviceUnavailable, unprocessable } from '../../plugins/error-handler.js';
import { ConversationRepository } from '../conversations/conversation.repository.js';
import {
  AttachmentDataUnavailableError,
  AttachmentRepository,
  type AttachmentRow,
} from './attachment.repository.js';
import type { FilesListQuery } from './attachment.schemas.js';
import {
  ATTACHMENT_DOWNLOAD_TTL_SECONDS,
  type AttachmentDownloadSigner,
} from './attachment.storage.js';

function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function safeNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** Public shape: deliberately omits bucket/key, credentials and extracted text. */
export function toLiveAttachment(row: AttachmentRow) {
  return {
    id: row.id,
    chatId: row.chat_id,
    historyId: row.history_id,
    senderType: row.sender_type,
    senderName: clean(row.sender_name),
    number: clean(row.number),
    fileName: row.file_name,
    mimeType: clean(row.mime_type),
    kind: row.file_kind,
    sizeBytes: safeNumber(row.size_bytes),
    caption: clean(row.caption),
    summary: clean(row.summary),
    createdAt: toIso(row.created_at),
  };
}

export function toMessageAttachment(row: AttachmentRow) {
  const attachment = toLiveAttachment(row);
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    kind: attachment.kind,
    sizeBytes: attachment.sizeBytes,
    caption: attachment.caption,
    summary: attachment.summary,
    createdAt: attachment.createdAt,
  };
}

export class AttachmentService {
  constructor(
    private readonly repository = new AttachmentRepository(),
    private readonly conversations = new ConversationRepository(),
    private readonly signer: AttachmentDownloadSigner | null = null,
    private readonly configuredBucket: string | undefined = undefined,
  ) {}

  private async guard<Result>(operation: () => Promise<Result>): Promise<Result> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AttachmentDataUnavailableError) {
        throw serviceUnavailable('Live attachment data is temporarily unavailable.');
      }
      throw error;
    }
  }

  async listForConversation(conversationId: number) {
    const conversation = await this.conversations.findById(conversationId);
    if (!conversation) throw notFound('Conversation not found');
    const chatId = clean(conversation.chat_id);
    if (!chatId) throw unprocessable('This conversation has no canonical chat id.');

    const rows = await this.guard(() => this.repository.listByChatId(chatId));
    return { items: rows.map(toLiveAttachment) };
  }

  async listFiles(query: FilesListQuery) {
    const offset = query.cursor ?? 0;
    const result = await this.guard(() =>
      this.repository.listFiles({
        limit: query.limit,
        offset,
        search: query.search,
        kind: query.kind,
      }),
    );
    return {
      items: result.rows.map(toLiveAttachment),
      nextCursor: result.hasMore ? String(offset + query.limit) : null,
    };
  }

  async createDownloadUrl(attachmentId: string) {
    const row = await this.guard(() => this.repository.findById(attachmentId));
    if (!row) throw notFound('Attachment not found');
    if (!this.signer || !this.configuredBucket) {
      throw serviceUnavailable('Attachment downloads are not configured for this environment.');
    }
    if (row.storage_bucket !== this.configuredBucket) {
      throw serviceUnavailable('This attachment is stored in an unavailable bucket.');
    }

    try {
      const url = await this.signer.sign({
        bucket: this.configuredBucket,
        key: row.storage_key,
        fileName: row.file_name,
      });
      return { url, expiresIn: ATTACHMENT_DOWNLOAD_TTL_SECONDS };
    } catch {
      throw serviceUnavailable('The attachment download link could not be created.');
    }
  }
}

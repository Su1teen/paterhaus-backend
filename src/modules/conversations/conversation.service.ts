import { notFound } from '../../plugins/error-handler.js';
import { parseAlmatyTime } from './conversation.time.js';
import type { ConversationListQuery } from './conversation.schemas.js';
import { ConversationRepository } from './conversation.repository.js';

const PREVIEW_LENGTH = 160;

function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function asIso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export class ConversationService {
  constructor(private readonly repository = new ConversationRepository()) {}

  async list(query: ConversationListQuery) {
    const offset = query.cursor ?? 0;
    const result = await this.repository.list({
      limit: query.limit,
      offset,
      search: query.search,
    });

    return {
      items: result.rows.map((row) => ({
        id: row.id,
        chatId: clean(row.chat_id),
        number: clean(row.number),
        contactName:
          clean(row.username) ??
          clean(row.latest_non_ai_username) ??
          clean(row.number) ??
          clean(row.chat_id) ??
          `Conversation ${row.id}`,
        aiEnabled: row.ai_enabled !== false,
        lastMessagePreview: clean(row.latest_message)?.slice(0, PREVIEW_LENGTH) ?? null,
        lastMessageId: row.latest_message_id,
        lastMessageTimeRaw: row.latest_message_time,
        lastMessageAt: parseAlmatyTime(row.latest_message_time),
      })),
      nextCursor: result.hasMore ? String(offset + query.limit) : null,
    };
  }

  async getMessages(id: number) {
    const conversation = await this.repository.findById(id);
    if (!conversation) throw notFound('Conversation not found');

    const chatId = clean(conversation.chat_id);
    const messages = chatId ? await this.repository.listMessages(chatId) : [];
    const fallbackContactName =
      clean(conversation.username) ?? clean(conversation.number) ?? chatId ?? `Conversation ${conversation.id}`;

    return {
      conversation: {
        id: conversation.id,
        chatId,
        number: clean(conversation.number),
        contactName: fallbackContactName,
        aiEnabled: conversation.ai_enabled !== false,
        aiResumedAt: asIso(conversation.ai_resumed_at),
      },
      messages: messages.map((message) => {
        const isAi = (message.username ?? '').trim().toLowerCase() === 'ai';
        return {
          id: message.id,
          chatId: clean(message.chat_id),
          senderName: isAi ? 'AI' : (clean(message.username) ?? fallbackContactName),
          senderType: isAi ? 'ai' : 'contact',
          direction: isAi ? 'outbound' : 'inbound',
          text: message.message ?? '',
          timeRaw: message.time,
          sentAt: parseAlmatyTime(message.time),
        };
      }),
    };
  }

  async setAiEnabled(id: number, aiEnabled: boolean) {
    const conversation = await this.repository.setAiEnabled(id, aiEnabled);
    if (!conversation) throw notFound('Conversation not found');

    return {
      id: conversation.id,
      chatId: clean(conversation.chat_id),
      aiEnabled: conversation.ai_enabled !== false,
      aiResumedAt: asIso(conversation.ai_resumed_at),
    };
  }
}

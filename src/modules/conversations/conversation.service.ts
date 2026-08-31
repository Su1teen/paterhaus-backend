import {
  HttpError,
  conflict,
  notFound,
  serviceUnavailable,
  unprocessable,
} from '../../plugins/error-handler.js';
import { formatAlmatyTime, parseAlmatyTime } from './conversation.time.js';
import type { ConversationListQuery } from './conversation.schemas.js';
import {
  ChatHistoryUnavailableError,
  ConversationRepository,
  type MessageRow,
} from './conversation.repository.js';
import type { OutboundMessageSender } from './conversation.outbound.js';

const PREVIEW_LENGTH = 160;
const HUMAN_USERNAME_PREFIX = 'human:';
const SEND_CACHE_TTL_MS = 10 * 60 * 1000;

export type SenderType = 'ai' | 'human' | 'contact';

export interface LiveMessage {
  id: number;
  chatId: string | null;
  senderName: string;
  senderType: SenderType;
  direction: 'inbound' | 'outbound';
  text: string;
  timeRaw: string | null;
  sentAt: string | null;
}

function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function asIso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** `hostory_pater` has no sender column, so the username encodes the sender. */
export function senderTypeFromUsername(username: string | null): SenderType {
  const normalized = (username ?? '').trim().toLowerCase();
  if (normalized === 'ai') return 'ai';
  if (normalized.startsWith(HUMAN_USERNAME_PREFIX)) return 'human';
  return 'contact';
}

function humanSenderName(username: string | null): string {
  const identity = (username ?? '').trim().slice(HUMAN_USERNAME_PREFIX.length).trim();
  return identity.length > 0 ? identity : 'Manager';
}

/** Short-lived record of completed sends, keyed by conversation + idempotency key. */
class SendResultCache {
  private readonly entries = new Map<string, { expiresAt: number; message: LiveMessage }>();

  get(key: string): LiveMessage | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.message;
  }

  set(key: string, message: LiveMessage): void {
    for (const [existingKey, entry] of this.entries) {
      if (entry.expiresAt <= Date.now()) this.entries.delete(existingKey);
    }
    this.entries.set(key, { expiresAt: Date.now() + SEND_CACHE_TTL_MS, message });
  }
}

export class ConversationService {
  private readonly sendResults = new SendResultCache();
  private readonly sendsInFlight = new Set<string>();

  constructor(
    private readonly repository = new ConversationRepository(),
    private readonly outboundSender: OutboundMessageSender | null = null,
  ) {}

  get manualRepliesSupported(): boolean {
    return this.outboundSender !== null;
  }

  /** Converts external-database failures into a safe 503 instead of empty data. */
  private async guard<Result>(operation: () => Promise<Result>): Promise<Result> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ChatHistoryUnavailableError) {
        throw serviceUnavailable('Live conversation data is temporarily unavailable.');
      }
      throw error;
    }
  }

  async list(query: ConversationListQuery) {
    const offset = query.cursor ?? 0;
    const result = await this.guard(() =>
      this.repository.list({ limit: query.limit, offset, search: query.search }),
    );

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

  /** Loads a conversation and asserts it carries a canonical chat id. */
  private async requireConversation(id: number) {
    const conversation = await this.guard(() => this.repository.findById(id));
    if (!conversation) throw notFound('Conversation not found');

    const chatId = clean(conversation.chat_id);
    if (!chatId) {
      throw unprocessable('This conversation has no canonical chat id and cannot be opened.');
    }

    return { conversation, chatId };
  }

  private toLiveMessage(message: MessageRow, fallbackContactName: string): LiveMessage {
    const senderType = senderTypeFromUsername(message.username);
    const senderName =
      senderType === 'ai'
        ? 'AI'
        : senderType === 'human'
          ? humanSenderName(message.username)
          : (clean(message.username) ?? fallbackContactName);

    return {
      id: message.id,
      chatId: clean(message.chat_id),
      senderName,
      senderType,
      direction: senderType === 'contact' ? 'inbound' : 'outbound',
      text: message.message ?? '',
      timeRaw: message.time,
      sentAt: parseAlmatyTime(message.time),
    };
  }

  async getMessages(id: number) {
    const { conversation, chatId } = await this.requireConversation(id);
    const messages = await this.guard(() => this.repository.listMessages(chatId));
    const fallbackContactName =
      clean(conversation.username) ?? clean(conversation.number) ?? chatId;

    return {
      conversation: {
        id: conversation.id,
        chatId,
        number: clean(conversation.number),
        contactName: fallbackContactName,
        aiEnabled: conversation.ai_enabled !== false,
        aiResumedAt: asIso(conversation.ai_resumed_at),
      },
      messages: messages.map((message) => this.toLiveMessage(message, fallbackContactName)),
    };
  }

  async setAiEnabled(id: number, aiEnabled: boolean) {
    const conversation = await this.guard(() => this.repository.setAiEnabled(id, aiEnabled));
    if (!conversation) throw notFound('Conversation not found');

    return {
      id: conversation.id,
      chatId: clean(conversation.chat_id),
      aiEnabled: conversation.ai_enabled !== false,
      aiResumedAt: asIso(conversation.ai_resumed_at),
    };
  }

  /**
   * Sends a human takeover reply. The message reaches `hostory_pater` only after
   * the outbound integration confirmed delivery, so a failed send leaves no row.
   */
  async sendHumanMessage(input: {
    conversationId: number;
    text: string;
    authorizedEmail: string;
    idempotencyKey: string;
  }): Promise<{ message: LiveMessage }> {
    const sender = this.outboundSender;
    if (!sender) {
      throw serviceUnavailable('Manual replies are not configured for this environment.');
    }

    const cacheKey = `${input.conversationId}:${input.idempotencyKey}`;
    const cached = this.sendResults.get(cacheKey);
    if (cached) return { message: cached };
    if (this.sendsInFlight.has(cacheKey)) {
      throw conflict('This message is already being sent.');
    }

    const { conversation, chatId } = await this.requireConversation(input.conversationId);
    if (conversation.ai_enabled !== false) {
      throw conflict('Take over the AI before sending a manual reply.');
    }

    this.sendsInFlight.add(cacheKey);
    try {
      try {
        await sender.send({
          conversationId: conversation.id,
          chatId,
          number: clean(conversation.number),
          text: input.text,
          authorizedEmail: input.authorizedEmail,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw serviceUnavailable('The message could not be delivered. Please try again.');
      }

      const row = await this.guard(() =>
        this.repository.insertHumanMessage({
          chatId,
          username: `${HUMAN_USERNAME_PREFIX}${input.authorizedEmail}`,
          text: input.text,
          time: formatAlmatyTime(new Date()),
        }),
      );

      const message = this.toLiveMessage(row, input.authorizedEmail);
      this.sendResults.set(cacheKey, message);
      return { message };
    } finally {
      this.sendsInFlight.delete(cacheKey);
    }
  }
}

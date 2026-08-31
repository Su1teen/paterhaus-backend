import { z } from 'zod';

export const accessTokenRequestSchema = z.object({
  email: z
    .string()
    .transform((email) => email.trim().toLowerCase())
    .pipe(z.string().email()),
});

export const conversationListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
  cursor: z.coerce.number().int().nonnegative().optional(),
  search: z.string().trim().max(200).optional(),
});

export const conversationIdParamSchema = z.object({
  conversationId: z.coerce.number().int().positive(),
});

export const updateConversationAiSchema = z.object({
  aiEnabled: z.boolean(),
});

export const MAX_MANUAL_MESSAGE_LENGTH = 4096;

export const sendConversationMessageSchema = z.object({
  text: z.string().trim().min(1, 'text is required').max(MAX_MANUAL_MESSAGE_LENGTH),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

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

export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

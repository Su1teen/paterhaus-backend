import { z } from 'zod';

export const attachmentKinds = [
  'image',
  'audio',
  'pdf',
  'word',
  'spreadsheet',
  'text',
  'other',
] as const;

export type AttachmentKind = (typeof attachmentKinds)[number];

export const attachmentIdParamSchema = z.object({
  attachmentId: z.string().trim().regex(/^\d+$/),
});

export const attachmentConversationParamSchema = z.object({
  conversationId: z.coerce.number().int().positive(),
});

export const filesListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
  cursor: z.coerce.number().int().nonnegative().optional(),
  search: z.string().trim().max(200).optional(),
  kind: z.enum(attachmentKinds).optional(),
});

export type FilesListQuery = z.infer<typeof filesListQuerySchema>;

import { z } from 'zod';

export const leadClassificationListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(100),
  cursor: z.coerce.number().int().nonnegative().optional(),
});

export type LeadClassificationListQuery = z.infer<typeof leadClassificationListQuerySchema>;

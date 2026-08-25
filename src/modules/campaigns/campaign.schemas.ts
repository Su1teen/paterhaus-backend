import { CampaignDirection, CampaignPlatform, CampaignStatus } from '@prisma/client';
import { z } from 'zod';

const uuid = z.string().uuid();

export const campaignIdParamSchema = z.object({ id: uuid });

export const campaignListQuerySchema = z.object({
  platform: z.nativeEnum(CampaignPlatform).optional(),
  direction: z.nativeEnum(CampaignDirection).optional(),
  status: z.nativeEnum(CampaignStatus).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(200),
  platform: z.nativeEnum(CampaignPlatform),
  direction: z.nativeEnum(CampaignDirection),
  status: z.nativeEnum(CampaignStatus),
  spendUsd: z.coerce.number().min(0, 'spendUsd must be non-negative').default(0),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const updateCampaignSchema = createCampaignSchema
  .partial()
  .extend({
    notes: z.string().trim().max(2000).nullable().optional(),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field must be provided' });

export type CampaignListQuery = z.infer<typeof campaignListQuerySchema>;
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

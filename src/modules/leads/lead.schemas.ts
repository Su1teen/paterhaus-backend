import { LeadDirection, LeadSource, MappingStatus } from '@prisma/client';
import { z } from 'zod';

const uuid = z.string().uuid();

export const leadIdParamSchema = z.object({ id: uuid });

export const leadListQuerySchema = z.object({
  direction: z.nativeEnum(LeadDirection).optional(),
  stage: z.string().trim().min(1).max(64).optional(),
  source: z.nativeEnum(LeadSource).optional(),
  mappingStatus: z.nativeEnum(MappingStatus).optional(),
  campaignId: uuid.optional(),
  search: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  archived: z.enum(['true', 'false']).default('false'),
});

export const createLeadSchema = z.object({
  externalLeadId: z.string().trim().min(1).max(128).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().min(1).max(50).optional(),
  email: z.string().trim().email().max(200).optional(),
  propertyType: z.string().trim().max(120).optional(),
  propertyArea: z.string().trim().max(120).optional(),
  bedrooms: z.number().int().min(0).max(50).optional(),
  serviceRaw: z.string().trim().max(200).optional(),
  direction: z.nativeEnum(LeadDirection).default(LeadDirection.UNCLASSIFIED),
  stage: z.string().trim().min(1).max(64).default('new'),
  source: z.nativeEnum(LeadSource).default(LeadSource.MANUAL),
  mappingStatus: z.nativeEnum(MappingStatus).optional(),
  campaignId: uuid.optional(),
  assignedUserId: uuid.optional(),
  firstResponseAt: z.coerce.date().optional(),
  firstResponseDueAt: z.coerce.date().optional(),
  followUpDueAt: z.coerce.date().optional(),
  lostReason: z.string().trim().max(500).optional(),
  priority: z.enum(['Low', 'Medium', 'High', 'Urgent']).optional(),
  nextActionType: z.enum(['FOLLOW_UP', 'CALL', 'SEND_PROPOSAL', 'NEGOTIATE', 'SITE_VISIT', 'WAITING_CLIENT', 'WAITING_PAYMENT', 'PAYMENT_RECEIVED', 'CREATE_PROJECT', 'OTHER']).optional(),
  nextActionText: z.string().trim().max(500).optional(),
  nextActionAt: z.coerce.date().optional(),
  note: z.string().trim().max(5000).optional(),
  quotedAmount: z.coerce.number().finite().min(0).max(999999999999).optional(),
  agreedAmount: z.coerce.number().finite().min(0).max(999999999999).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).default('AED'),
});

export const updateLeadSchema = createLeadSchema
  .partial()
  .extend({
    campaignId: uuid.nullable().optional(),
    assignedUserId: uuid.nullable().optional(),
    lostReason: z.string().trim().max(500).nullable().optional(),
    nextActionText: z.string().trim().max(500).nullable().optional(),
    nextActionAt: z.coerce.date().nullable().optional(),
    note: z.string().trim().max(5000).nullable().optional(),
    quotedAmount: z.coerce.number().finite().min(0).max(999999999999).nullable().optional(),
    agreedAmount: z.coerce.number().finite().min(0).max(999999999999).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export type LeadListQuery = z.infer<typeof leadListQuerySchema>;
export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

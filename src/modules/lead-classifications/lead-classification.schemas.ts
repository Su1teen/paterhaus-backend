import { z } from 'zod';

/** `pater_classification.lead_type` — the PROPERTY type of the lead (not the contact's role). */
export const LEAD_PROPERTY_TYPES = ['Apartment', 'Villa', 'Townhouse', 'Studio', 'Other'] as const;
/** `pater_classification.work_type` — the requested Paterhaus service. */
export const LEAD_SERVICES = ['Staging', 'Snagging', 'Property Management'] as const;
export const LEAD_STAGES = ['new', 'talking', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const;
export const LEAD_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const;

export const MANUAL_LEAD_DEFAULT_STAGE = 'new';
export const MANUAL_LEAD_DEFAULT_PRIORITY = 'Medium';
export const MANUAL_LEAD_SUMMARY = 'Manual lead created from CRM. Conversation has not started yet.';

/** Accounts allowed to create leads manually, independent of `CRM_ALLOWED_EMAILS`. */
export const MANUAL_LEAD_ALLOWED_EMAILS: ReadonlySet<string> = new Set([
  'info@paterhaus.com',
  'r_tszi@paterhaus.com',
]);

export type LeadPropertyType = (typeof LEAD_PROPERTY_TYPES)[number];
export type LeadService = (typeof LEAD_SERVICES)[number];

export const leadClassificationListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(100),
  cursor: z.coerce.number().int().nonnegative().optional(),
});

export type LeadClassificationListQuery = z.infer<typeof leadClassificationListQuerySchema>;

/**
 * Reduces a user-entered phone number to digits only. Spaces, hyphens, dots,
 * parentheses and a leading `+` are removed; nothing is prepended. Returns null when
 * the remainder is not a plausible phone number.
 */
export function normalizeManualPhone(input: string): string | null {
  const stripped = input.trim().replace(/^\+/, '').replace(/[\s\-().]/g, '');
  if (!/^\d{7,15}$/.test(stripped)) return null;
  return stripped;
}

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    });

export const manualLeadRequestSchema = z.object({
  name: optionalText(200),
  phoneNumber: z
    .string({ required_error: 'Phone number is required' })
    .trim()
    .min(1, 'Phone number is required')
    .max(40)
    .transform((value, ctx) => {
      const normalized = normalizeManualPhone(value);
      if (!normalized) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid phone number' });
        return z.NEVER;
      }
      return normalized;
    }),
  email: optionalText(254).pipe(z.string().email('Enter a valid email address').nullable()),
  propertyType: z.enum(LEAD_PROPERTY_TYPES, {
    errorMap: () => ({ message: 'Property type must be Apartment, Villa, Townhouse, Studio or Other' }),
  }),
  service: z.enum(LEAD_SERVICES, {
    errorMap: () => ({ message: 'Service must be Staging, Snagging or Property Management' }),
  }),
});

export type ManualLeadRequest = z.infer<typeof manualLeadRequestSchema>;

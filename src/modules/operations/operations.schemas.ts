import { ProjectPaymentStatus, ProjectPaymentType, ProjectStatus } from '@prisma/client';
import { z } from 'zod';

export const idParam = z.object({ id: z.string().uuid() });
const id = z.string().uuid();
const text = z.string().trim().min(1).max(200);
const optionalText = z.string().trim().max(2000).nullable().optional();
const nullableId = id.nullable().optional();
const money = z.coerce.number().finite().min(0).max(999999999999).nullable().optional();
const currency = z.string().regex(/^[A-Z]{3}$/).default('AED');
const serviceTypes = z.array(z.string().trim().min(1).max(80)).min(1).max(10).refine(
  (values) => new Set(values).size === values.length,
  'Service types must not repeat',
);
const date = z.coerce.date();

export const propertyInput = z.object({
  name: text, address: optionalText, area: optionalText, type: optionalText, unit: optionalText,
  bedrooms: z.number().int().min(0).max(100).nullable().optional(),
  bathrooms: z.number().int().min(0).max(100).nullable().optional(),
  ownerLeadId: nullableId, status: z.string().trim().min(1).max(40).optional(), notes: optionalText,
}).strict();
export const contractorInput = z.object({
  name: text, contactPerson: optionalText, phone: optionalText, email: z.string().email().nullable().optional(),
  notes: optionalText, active: z.boolean().optional(), serviceTypes,
}).strict();
export const projectFields = z.object({
  name: text, propertyId: nullableId, ownerLeadId: nullableId, sourceOpportunityId: nullableId,
  serviceDirections: serviceTypes, status: z.nativeEnum(ProjectStatus).optional(),
  quotedAmount: money, agreedAmount: money, currency,
  startDate: date.nullable().optional(), expectedCompletionDate: date.nullable().optional(),
  completedAt: date.nullable().optional(), comment: optionalText,
}).strict();
export const projectInput = projectFields.refine((input) =>
  !input.startDate || !input.expectedCompletionDate || input.startDate <= input.expectedCompletionDate,
  { message: 'Expected completion must not precede start', path: ['expectedCompletionDate'] },
);
export const milestoneInput = z.object({
  title: text, sortOrder: z.number().int().min(0).max(10000),
  completedAt: date.nullable().optional(), comment: optionalText,
  responsible: optionalText,
}).strict();
export const paymentInput = z.object({
  amount: z.coerce.number().finite().positive().max(999999999999),
  currency, type: z.nativeEnum(ProjectPaymentType),
  status: z.nativeEnum(ProjectPaymentStatus).default(ProjectPaymentStatus.PAID),
  paidAt: date.nullable().optional(), note: optionalText,
}).strict().refine((input) => input.status !== 'PAID' || Boolean(input.paidAt),
  { message: 'Paid date is required for a settled payment', path: ['paidAt'] });
export const assignmentInput = z.object({
  contractorId: id, scope: optionalText, amount: money, currency,
  status: optionalText, completedAt: date.nullable().optional(), note: optionalText,
}).strict();
export const guestInput = z.object({
  name: text, phone: optionalText, email: z.string().email().nullable().optional(),
  nationality: optionalText, notes: optionalText,
}).strict();
export const stayFields = z.object({
  propertyId: id, guestId: id, source: optionalText,
  checkIn: date, checkOut: date, guestCount: z.number().int().min(1).max(100).default(1),
  bookingValue: money, currency, paymentStatus: text.optional(), status: text.optional(), notes: optionalText,
}).strict();
export const stayInput = stayFields.refine((input) => input.checkOut > input.checkIn,
  { message: 'Check-out must follow check-in', path: ['checkOut'] });

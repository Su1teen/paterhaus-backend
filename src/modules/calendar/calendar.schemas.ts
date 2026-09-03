import { z } from 'zod';

export const CALENDAR_EVENT_KINDS = ['operation', 'booking', 'blocked', 'risk', 'occupied'] as const;
export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number];

const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Calendar day in Asia/Dubai (`YYYY-MM-DD`). */
export const calendarDateSchema = z
  .string()
  .regex(DATE_PATTERN, 'Date must be YYYY-MM-DD')
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), 'Date is invalid');

const optionalTime = z
  .string()
  .trim()
  .regex(TIME_PATTERN, 'Time must be HH:MM')
  .optional()
  .nullable()
  .transform((value) => value ?? null);

export const calendarListQuerySchema = z
  .object({
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'from must not be after to',
    path: ['to'],
  });

export const createCalendarEventSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200),
    description: z
      .string()
      .max(2000)
      .optional()
      .nullable()
      .transform((value) => {
        const trimmed = value?.trim();
        return trimmed ? trimmed : null;
      }),
    eventDate: calendarDateSchema,
    startTime: optionalTime,
    endTime: optionalTime,
    kind: z.enum(CALENDAR_EVENT_KINDS).default('operation'),
  })
  .refine((event) => !event.startTime || !event.endTime || event.startTime <= event.endTime, {
    message: 'End time must not be before start time',
    path: ['endTime'],
  });

export const calendarEventIdParamSchema = z.object({
  eventId: z.string().uuid(),
});

export type CalendarListQuery = z.infer<typeof calendarListQuerySchema>;
export type CreateCalendarEventInput = z.infer<typeof createCalendarEventSchema>;

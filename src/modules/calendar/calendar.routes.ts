import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { notFound } from '../../plugins/error-handler.js';
import { requireConversationAccess } from '../conversations/conversation.auth.js';
import {
  CALENDAR_EVENT_KINDS,
  calendarEventIdParamSchema,
  calendarListQuerySchema,
  createCalendarEventSchema,
} from './calendar.schemas.js';

const calendarTag = { tags: ['paterhaus-calendar'] } as const;

/**
 * Persistent calendar shared by the allowlisted Paterhaus CRM accounts.
 * Dates are stored as Asia/Dubai calendar days (`YYYY-MM-DD`), so no timezone
 * conversion happens on the server.
 */
export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/paterhaus/calendar/events',
    {
      preHandler: requireConversationAccess,
      schema: {
        ...calendarTag,
        summary: 'List calendar events (optionally within an inclusive date range)',
        querystring: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'YYYY-MM-DD (Asia/Dubai)' },
            to: { type: 'string', description: 'YYYY-MM-DD (Asia/Dubai)' },
          },
        },
      },
    },
    async (request) => {
      const query = calendarListQuerySchema.parse(request.query);
      const items = await prisma.calendarEvent.findMany({
        where: {
          eventDate: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        },
        orderBy: [{ eventDate: 'asc' }, { startTime: 'asc' }, { createdAt: 'asc' }],
      });
      return { items, timeZone: 'Asia/Dubai' };
    },
  );

  app.post(
    '/api/paterhaus/calendar/events',
    {
      preHandler: requireConversationAccess,
      schema: {
        ...calendarTag,
        summary: 'Create a calendar event',
        body: {
          type: 'object',
          required: ['title', 'eventDate'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: ['string', 'null'], maxLength: 2000 },
            eventDate: { type: 'string', description: 'YYYY-MM-DD (Asia/Dubai)' },
            startTime: { type: ['string', 'null'], description: 'HH:MM' },
            endTime: { type: ['string', 'null'], description: 'HH:MM' },
            kind: { type: 'string', enum: [...CALENDAR_EVENT_KINDS], default: 'operation' },
          },
        },
      },
    },
    async (request, reply) => {
      const input = createCalendarEventSchema.parse(request.body);
      const event = await prisma.calendarEvent.create({
        data: { ...input, createdBy: request.conversationAccessEmail ?? '' },
      });
      return reply.status(201).send(event);
    },
  );

  app.delete(
    '/api/paterhaus/calendar/events/:eventId',
    {
      preHandler: requireConversationAccess,
      schema: {
        ...calendarTag,
        summary: 'Delete a calendar event',
        params: {
          type: 'object',
          required: ['eventId'],
          properties: { eventId: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const { eventId } = calendarEventIdParamSchema.parse(request.params);
      const deleted = await prisma.calendarEvent.deleteMany({ where: { id: eventId } });
      if (deleted.count === 0) throw notFound('Calendar event not found');
      return reply.status(204).send();
    },
  );
}

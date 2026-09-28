import type { FastifyInstance } from 'fastify';
import { requirePaterhausAccess } from '../../plugins/paterhaus-auth.js';
import { prisma } from '../../lib/prisma.js';
import { HttpError, notFound } from '../../plugins/error-handler.js';
import { z } from 'zod';
import { LeadDirection, MappingStatus } from '@prisma/client';
import { LeadClassificationService } from '../lead-classifications/lead-classification.service.js';
import { normalizePhone } from '../../utils/normalize-phone.js';
import {
  createLeadSchema,
  leadIdParamSchema,
  leadListQuerySchema,
  updateLeadSchema,
} from './lead.schemas.js';
import { createLead, deleteLead, getLead, listLeads, updateLead } from './lead.service.js';

const leadTag = { tags: ['leads'] } as const;

export async function leadRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requirePaterhausAccess);
  app.get('/api/paterhaus/users', async () => ({
    items: await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    }),
  }));
  app.get('/api/paterhaus/opportunities', async () => {
    let integrationStatus: 'live' | 'unavailable' = 'live';
    try {
      const classifications = await new LeadClassificationService().list({ limit: 100 });
      const keyed = classifications.items.filter((item) => item.chatId);
      const existing = await prisma.lead.findMany({ where: { externalChatId: { in: keyed.map((item) => item.chatId!) } },
        select: { externalChatId: true } });
      const existingIds = new Set(existing.map((lead) => lead.externalChatId));
      for (const item of keyed) {
        if (existingIds.has(item.chatId)) continue;
        const direction = item.workType === 'Staging' ? LeadDirection.STAGING
          : item.workType === 'Snagging' ? LeadDirection.SNAGGING
          : item.workType === 'Property Management' ? LeadDirection.PROPERTY_MANAGEMENT : LeadDirection.UNCLASSIFIED;
        const phone = normalizePhone(item.number);
        const candidate = phone ? await prisma.lead.findFirst({ where: { normalizedPhone: phone, externalChatId: null }, orderBy: { createdAt: 'asc' } }) : null;
        if (candidate) {
          const linked = await prisma.lead.updateMany({ where: { id: candidate.id, externalChatId: null }, data: { externalChatId: item.chatId } });
          if (linked.count) continue;
        }
        await prisma.lead.createMany({ data: [{ externalChatId: item.chatId, name: item.name,
          phone: item.number, normalizedPhone: phone, email: item.email,
          normalizedEmail: item.email?.toLowerCase() ?? null, propertyType: item.leadType,
          direction, stage: item.stage?.toLowerCase() ?? 'new', priority: item.priority,
          note: item.summary, source: 'WHATSAPP', mappingStatus: direction === 'UNCLASSIFIED' ? MappingStatus.NEEDS_REVIEW : MappingStatus.MAPPED }],
          skipDuplicates: true });
        existingIds.add(item.chatId);
      }
    } catch (error) {
      if (!(error instanceof HttpError) || error.statusCode !== 503) throw error;
      integrationStatus = 'unavailable';
    }
    const items = await prisma.lead.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'desc' }, take: 100,
      include: { assignedUser: { select: { id: true, name: true, email: true, role: true } } } });
    return { items, integrationStatus };
  });
  app.get(
    '/leads',
    {
      schema: {
        ...leadTag,
        summary: 'List leads',
        querystring: {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['UNCLASSIFIED', 'PROPERTY_MANAGEMENT', 'SNAGGING', 'STAGING'] },
            stage: { type: 'string' },
            source: {
              type: 'string',
              enum: ['META_CONNECTOR', 'META_LEAD_ADS', 'WHATSAPP', 'WEBSITE', 'REFERRAL', 'MANUAL', 'OTHER'],
            },
            mappingStatus: { type: 'string', enum: ['MAPPED', 'NEEDS_REVIEW', 'FAILED'] },
            campaignId: { type: 'string', format: 'uuid' },
            search: { type: 'string' },
            page: { type: 'integer', minimum: 1 },
            limit: { type: 'integer', minimum: 1, description: 'Page size; clamped to a maximum of 100' },
          },
        },
      },
    },
    async (request) => listLeads(leadListQuerySchema.parse(request.query)),
  );

  app.get(
    '/leads/:id',
    { schema: { ...leadTag, summary: 'Get a lead by id' } },
    async (request) => {
      const { id } = leadIdParamSchema.parse(request.params);
      return getLead(id);
    },
  );

  app.post(
    '/leads',
    {
      schema: {
        ...leadTag,
        summary: 'Create a lead',
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'Ivan Ivanov' },
            phone: { type: 'string', example: '+77001234567' },
            email: { type: 'string', example: 'ivan@example.com' },
            propertyType: { type: 'string', example: 'Apartment' },
            serviceRaw: { type: 'string', example: 'Snagging' },
            direction: { type: 'string', enum: ['UNCLASSIFIED', 'PROPERTY_MANAGEMENT', 'SNAGGING', 'STAGING'] },
            stage: { type: 'string', example: 'new' },
            source: {
              type: 'string',
              enum: ['META_CONNECTOR', 'META_LEAD_ADS', 'WHATSAPP', 'WEBSITE', 'REFERRAL', 'MANUAL', 'OTHER'],
            },
            campaignId: { type: 'string', format: 'uuid' },
            assignedUserId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request, reply) => {
      const input = createLeadSchema.parse(request.body);
      const lead = await createLead(input);
      return reply.status(201).send(lead);
    },
  );

  app.patch(
    '/leads/:id',
    { schema: { ...leadTag, summary: 'Update a lead', body: { type: 'object', additionalProperties: true } } },
    async (request) => {
      const { id } = leadIdParamSchema.parse(request.params);
      const input = updateLeadSchema.parse(request.body);
      return updateLead(id, input);
    },
  );

  app.patch('/api/paterhaus/leads/:id/archive', async (request) => {
    const { id } = leadIdParamSchema.parse(request.params);
    const { archived } = z.object({ archived: z.boolean() }).parse(request.body);
    if (!(await prisma.lead.count({ where: { id } }))) throw notFound('Lead not found');
    return prisma.lead.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
  });

  app.delete(
    '/leads/:id',
    { schema: { ...leadTag, summary: 'Delete a lead' } },
    async (request, reply) => {
      const { id } = leadIdParamSchema.parse(request.params);
      await deleteLead(id);
      return reply.status(204).send();
    },
  );
}

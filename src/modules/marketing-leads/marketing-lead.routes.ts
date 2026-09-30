import type { FastifyInstance } from 'fastify';
import { requirePaterhausAccess } from '../../plugins/paterhaus-auth.js';
import { prisma } from '../../lib/prisma.js';
import { notFound } from '../../plugins/error-handler.js';
import { z } from 'zod';

const idParam = z.object({ id: z.string().uuid() });

const entryInput = z.object({
  entryDate: z.coerce.date(),
  name: z.string().trim().min(1).max(300),
  phone: z.string().trim().max(50).nullable().optional(),
  email: z.string().email().nullable().optional(),
  propertyType: z.string().trim().max(100).nullable().optional(),
  service: z.string().trim().max(100).nullable().optional(),
  firstFollowUp: z.string().trim().max(500).nullable().optional(),
  secondFollowUp: z.string().trim().max(500).nullable().optional(),
  comments: z.string().trim().max(2000).nullable().optional(),
  campaignId: z.string().uuid().nullable().optional(),
});

export async function marketingLeadRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requirePaterhausAccess);

  // List
  app.get('/api/paterhaus/marketing-leads', async (request) => {
    const { archived, campaignId } = z.object({
      archived: z.coerce.boolean().default(false),
      campaignId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    }).parse(request.query);
    const where: Record<string, unknown> = {
      archivedAt: archived ? { not: null } : null,
    };
    if (campaignId) where['campaignId'] = campaignId;
    const items = await prisma.marketingLeadEntry.findMany({
      where: where as Parameters<typeof prisma.marketingLeadEntry.findMany>[0]['where'],
      orderBy: { entryDate: 'desc' },
      take: 200,
      include: { campaign: { select: { id: true, name: true } } },
    });
    return { items, total: items.length };
  });

  // Create
  app.post('/api/paterhaus/marketing-leads', async (request, reply) => {
    const input = entryInput.parse(request.body);
    const entry = await prisma.marketingLeadEntry.create({
      data: {
        entryDate: input.entryDate,
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        propertyType: input.propertyType ?? null,
        service: input.service ?? null,
        firstFollowUp: input.firstFollowUp ?? null,
        secondFollowUp: input.secondFollowUp ?? null,
        comments: input.comments ?? null,
        campaignId: input.campaignId ?? null,
      },
      include: { campaign: { select: { id: true, name: true } } },
    });
    return reply.status(201).send(entry);
  });

  // Update
  app.patch('/api/paterhaus/marketing-leads/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const existing = await prisma.marketingLeadEntry.findUnique({ where: { id } });
    if (!existing) throw notFound('Marketing lead entry not found');
    const input = entryInput.partial().parse(request.body);
    return prisma.marketingLeadEntry.update({
      where: { id },
      data: {
        ...input,
        phone: 'phone' in input ? (input.phone ?? null) : undefined,
        email: 'email' in input ? (input.email ?? null) : undefined,
        propertyType: 'propertyType' in input ? (input.propertyType ?? null) : undefined,
        service: 'service' in input ? (input.service ?? null) : undefined,
        firstFollowUp: 'firstFollowUp' in input ? (input.firstFollowUp ?? null) : undefined,
        secondFollowUp: 'secondFollowUp' in input ? (input.secondFollowUp ?? null) : undefined,
        comments: 'comments' in input ? (input.comments ?? null) : undefined,
        campaignId: 'campaignId' in input ? (input.campaignId ?? null) : undefined,
      },
      include: { campaign: { select: { id: true, name: true } } },
    });
  });

  // Archive / Unarchive
  app.patch('/api/paterhaus/marketing-leads/:id/archive', async (request) => {
    const { id } = idParam.parse(request.params);
    const { archived } = z.object({ archived: z.boolean() }).parse(request.body);
    if (!(await prisma.marketingLeadEntry.count({ where: { id } }))) throw notFound('Marketing lead entry not found');
    return prisma.marketingLeadEntry.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
    });
  });

  // Delete
  app.delete('/api/paterhaus/marketing-leads/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!(await prisma.marketingLeadEntry.count({ where: { id } }))) throw notFound('Marketing lead entry not found');
    await prisma.marketingLeadEntry.delete({ where: { id } });
    return reply.status(204).send();
  });
}

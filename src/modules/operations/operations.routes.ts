import { Prisma, type ServiceProject } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { requirePaterhausAdmin } from '../../plugins/paterhaus-auth.js';
import { badRequest, conflict, notFound } from '../../plugins/error-handler.js';
import { projectMoney } from './operations.money.js';
import {
  assignmentInput, contractorInput, guestInput, idParam, milestoneInput, paymentInput,
  projectFields, projectInput, propertyInput, stayFields, stayInput,
} from './operations.schemas.js';

const listQuery = z.object({ page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50), archived: z.enum(['true', 'false']).default('false') });
const projectInclude = {
  property: true, ownerLead: { select: { id: true, name: true } },
  sourceOpportunity: { select: { id: true, name: true } },
  milestones: { orderBy: { sortOrder: 'asc' as const } }, payments: { orderBy: { createdAt: 'desc' as const } },
  contractors: { include: { contractor: true } },
};

function projectDto(project: ServiceProject & { payments: Awaited<ReturnType<typeof prisma.projectPayment.findMany>> }) {
  return { ...project, money: projectMoney(project) };
}

async function projectById(id: string) {
  const project = await prisma.serviceProject.findUnique({ where: { id }, include: projectInclude });
  if (!project) throw notFound('Project not found');
  return projectDto(project);
}

export async function operationsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requirePaterhausAdmin);

  app.get('/api/paterhaus/properties', async (request) => {
    const query = listQuery.parse(request.query);
    const where = { archivedAt: query.archived === 'true' ? { not: null } : null };
    const [items, total] = await Promise.all([
      prisma.property.findMany({ where, take: query.limit, skip: (query.page - 1) * query.limit, orderBy: { createdAt: 'desc' } }),
      prisma.property.count({ where }),
    ]);
    return { items, total };
  });
  app.post('/api/paterhaus/properties', async (request, reply) =>
    reply.code(201).send(await prisma.property.create({ data: propertyInput.parse(request.body) })));
  app.get('/api/paterhaus/properties/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const property = await prisma.property.findUnique({ where: { id }, include: { projects: true, stays: true } });
    if (!property) throw notFound('Property not found');
    return property;
  });
  app.patch('/api/paterhaus/properties/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const input = propertyInput.partial().parse(request.body);
    if (!(await prisma.property.count({ where: { id } }))) throw notFound('Property not found');
    return prisma.property.update({ where: { id }, data: input });
  });
  app.patch('/api/paterhaus/properties/:id/archive', async (request) => {
    const { id } = idParam.parse(request.params);
    const input = z.object({ archived: z.boolean() }).parse(request.body);
    if (!(await prisma.property.count({ where: { id } }))) throw notFound('Property not found');
    return prisma.property.update({ where: { id }, data: { archivedAt: input.archived ? new Date() : null } });
  });
  app.delete('/api/paterhaus/properties/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const property = await prisma.property.findUnique({ where: { id }, include: { _count: { select: { projects: true, stays: true } } } });
    if (!property) throw notFound('Property not found');
    if (property._count.projects || property._count.stays) throw conflict('Archive a property with projects or stays instead');
    await prisma.property.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.get('/api/paterhaus/contractors', async (request) => {
    const query = listQuery.parse(request.query);
    const where = query.archived === 'true' ? { active: false } : { active: true };
    const [items, total] = await Promise.all([
      prisma.contractor.findMany({ where, take: query.limit, skip: (query.page - 1) * query.limit, orderBy: { name: 'asc' } }),
      prisma.contractor.count({ where }),
    ]);
    return { items, total };
  });
  app.post('/api/paterhaus/contractors', async (request, reply) =>
    reply.code(201).send(await prisma.contractor.create({ data: contractorInput.parse(request.body) })));
  app.get('/api/paterhaus/contractors/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const contractor = await prisma.contractor.findUnique({ where: { id }, include: { assignments: true } });
    if (!contractor) throw notFound('Contractor not found');
    return contractor;
  });
  app.patch('/api/paterhaus/contractors/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    if (!(await prisma.contractor.count({ where: { id } }))) throw notFound('Contractor not found');
    return prisma.contractor.update({ where: { id }, data: contractorInput.partial().parse(request.body) });
  });
  app.delete('/api/paterhaus/contractors/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const contractor = await prisma.contractor.findUnique({ where: { id }, include: { _count: { select: { assignments: true } } } });
    if (!contractor) throw notFound('Contractor not found');
    if (contractor._count.assignments) throw conflict('Deactivate an assigned contractor instead');
    await prisma.contractor.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.get('/api/paterhaus/projects', async (request) => {
    const query = listQuery.parse(request.query);
    const where = { archivedAt: query.archived === 'true' ? { not: null } : null };
    const [projects, total] = await Promise.all([
      prisma.serviceProject.findMany({ where, include: projectInclude, take: query.limit,
        skip: (query.page - 1) * query.limit, orderBy: { createdAt: 'desc' } }),
      prisma.serviceProject.count({ where }),
    ]);
    return { items: projects.map(projectDto), total };
  });
  app.post('/api/paterhaus/projects', async (request, reply) => {
    const input = projectInput.parse(request.body);
    const created = await prisma.serviceProject.create({ data: {
      ...input, quotedAmount: input.quotedAmount == null ? null : new Prisma.Decimal(input.quotedAmount),
      agreedAmount: input.agreedAmount == null ? null : new Prisma.Decimal(input.agreedAmount),
      confirmedAt: input.status === 'CONFIRMED' ? new Date() : null,
      completedAt: input.status === 'COMPLETED' ? new Date() : input.completedAt,
    } });
    return reply.code(201).send(await projectById(created.id));
  });
  app.get('/api/paterhaus/projects/:id', async (request) => projectById(idParam.parse(request.params).id));
  app.patch('/api/paterhaus/projects/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const input = projectFields.partial().parse(request.body);
    const existing = await prisma.serviceProject.findUnique({ where: { id } });
    if (!existing) throw notFound('Project not found');
    projectInput.parse({
      ...existing, ...input,
      quotedAmount: input.quotedAmount ?? existing.quotedAmount?.toNumber() ?? null,
      agreedAmount: input.agreedAmount ?? existing.agreedAmount?.toNumber() ?? null,
    });
    await prisma.serviceProject.update({ where: { id }, data: {
      ...input,
      ...(input.quotedAmount !== undefined ? { quotedAmount: input.quotedAmount == null ? null : new Prisma.Decimal(input.quotedAmount) } : {}),
      ...(input.agreedAmount !== undefined ? { agreedAmount: input.agreedAmount == null ? null : new Prisma.Decimal(input.agreedAmount) } : {}),
      ...(input.status === 'CONFIRMED' && existing.status !== 'CONFIRMED' ? { confirmedAt: new Date() } : {}),
      ...(input.status === 'COMPLETED' && existing.status !== 'COMPLETED' ? { completedAt: new Date() } : {}),
    } });
    return projectById(id);
  });
  app.patch('/api/paterhaus/projects/:id/archive', async (request) => {
    const { id } = idParam.parse(request.params);
    const { archived } = z.object({ archived: z.boolean() }).parse(request.body);
    if (!(await prisma.serviceProject.count({ where: { id } }))) throw notFound('Project not found');
    await prisma.serviceProject.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    return projectById(id);
  });
  app.delete('/api/paterhaus/projects/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!(await prisma.serviceProject.count({ where: { id } }))) throw notFound('Project not found');
    if (await prisma.projectPayment.count({ where: { projectId: id } })) throw conflict('Archive a project with payments instead');
    await prisma.serviceProject.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.post('/api/paterhaus/projects/:id/milestones', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!(await prisma.serviceProject.count({ where: { id } }))) throw notFound('Project not found');
    return reply.code(201).send(await prisma.projectMilestone.create({ data: { ...milestoneInput.parse(request.body), projectId: id } }));
  });
  app.patch('/api/paterhaus/projects/:id/milestones/:itemId', async (request) => {
    const { id } = idParam.parse(request.params);
    const { itemId } = z.object({ itemId: z.string().uuid() }).parse(request.params);
    const data = milestoneInput.partial().parse(request.body);
    const updated = await prisma.projectMilestone.updateMany({ where: { id: itemId, projectId: id }, data });
    if (!updated.count) throw notFound('Milestone not found');
    return prisma.projectMilestone.findUniqueOrThrow({ where: { id: itemId } });
  });
  app.delete('/api/paterhaus/projects/:id/milestones/:itemId', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { itemId } = z.object({ itemId: z.string().uuid() }).parse(request.params);
    const deleted = await prisma.projectMilestone.deleteMany({ where: { id: itemId, projectId: id } });
    if (!deleted.count) throw notFound('Milestone not found');
    return reply.code(204).send();
  });
  app.post('/api/paterhaus/projects/:id/payments', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const project = await prisma.serviceProject.findUnique({ where: { id } });
    if (!project) throw notFound('Project not found');
    const input = paymentInput.parse(request.body);
    if (input.currency !== project.currency) throw badRequest('Payment currency must match project currency');
    return reply.code(201).send(await prisma.projectPayment.create({ data: {
      ...input, amount: new Prisma.Decimal(input.amount), projectId: id,
    } }));
  });
  app.post('/api/paterhaus/projects/:id/contractors', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const project = await prisma.serviceProject.findUnique({ where: { id } });
    if (!project) throw notFound('Project not found');
    const input = assignmentInput.parse(request.body);
    if (input.currency !== project.currency) throw badRequest('Assignment currency must match project currency');
    const contractor = await prisma.contractor.findUnique({ where: { id: input.contractorId } });
    if (!contractor || !contractor.active) throw badRequest('Select an active contractor');
    return reply.code(201).send(await prisma.projectContractorAssignment.create({ data: {
      ...input, projectId: id, amount: input.amount == null ? null : new Prisma.Decimal(input.amount),
    } }));
  });
  app.delete('/api/paterhaus/projects/:id/contractors/:contractorId', async (request, reply) => {
    const { id, contractorId } = z.object({ id: z.string().uuid(), contractorId: z.string().uuid() }).parse(request.params);
    const removed = await prisma.projectContractorAssignment.deleteMany({ where: { projectId: id, contractorId } });
    if (!removed.count) throw notFound('Assignment not found');
    return reply.code(204).send();
  });

  app.get('/api/paterhaus/guests', async (request) => {
    const query = listQuery.parse(request.query);
    return prisma.guest.findMany({ take: query.limit, skip: (query.page - 1) * query.limit, orderBy: { createdAt: 'desc' } });
  });
  app.post('/api/paterhaus/guests', async (request, reply) =>
    reply.code(201).send(await prisma.guest.create({ data: guestInput.parse(request.body) })));
  app.get('/api/paterhaus/guests/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const guest = await prisma.guest.findUnique({ where: { id }, include: { stays: true } });
    if (!guest) throw notFound('Guest not found');
    return guest;
  });
  app.patch('/api/paterhaus/guests/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    if (!(await prisma.guest.count({ where: { id } }))) throw notFound('Guest not found');
    return prisma.guest.update({ where: { id }, data: guestInput.partial().parse(request.body) });
  });
  app.delete('/api/paterhaus/guests/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!(await prisma.guest.count({ where: { id } }))) throw notFound('Guest not found');
    if (await prisma.stay.count({ where: { guestId: id } })) throw conflict('Guest has stays');
    await prisma.guest.delete({ where: { id } });
    return reply.code(204).send();
  });
  app.get('/api/paterhaus/stays', async (request) => {
    const query = listQuery.parse(request.query);
    return prisma.stay.findMany({ take: query.limit, skip: (query.page - 1) * query.limit,
      orderBy: { checkIn: 'desc' }, include: { property: true, guest: true } });
  });
  app.post('/api/paterhaus/stays', async (request, reply) => {
    const input = stayInput.parse(request.body);
    return reply.code(201).send(await prisma.stay.create({ data: {
      ...input, bookingValue: input.bookingValue == null ? null : new Prisma.Decimal(input.bookingValue),
    } }));
  });
  app.get('/api/paterhaus/stays/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const stay = await prisma.stay.findUnique({ where: { id }, include: { property: true, guest: true } });
    if (!stay) throw notFound('Stay not found');
    return stay;
  });
  app.patch('/api/paterhaus/stays/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const existing = await prisma.stay.findUnique({ where: { id } });
    if (!existing) throw notFound('Stay not found');
    const input = stayFields.partial().parse(request.body);
    stayInput.parse({ ...existing, ...input, bookingValue: input.bookingValue ?? existing.bookingValue?.toNumber() ?? null });
    return prisma.stay.update({ where: { id }, data: {
      ...input, ...(input.bookingValue !== undefined ? { bookingValue: input.bookingValue == null ? null : new Prisma.Decimal(input.bookingValue) } : {}),
    } });
  });
  app.delete('/api/paterhaus/stays/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const removed = await prisma.stay.deleteMany({ where: { id } });
    if (!removed.count) throw notFound('Stay not found');
    return reply.code(204).send();
  });
}

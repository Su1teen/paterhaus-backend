import { MappingStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { conflict, notFound } from '../../plugins/error-handler.js';
import { normalizeEmail } from '../../utils/normalize-email.js';
import { normalizePhone } from '../../utils/normalize-phone.js';
import { buildMeta, resolvePagination, type PaginatedMeta } from '../../utils/pagination.js';
import type { CreateLeadInput, LeadListQuery, UpdateLeadInput } from './lead.schemas.js';

const leadInclude = {
  attribution: true,
  campaign: { select: { id: true, name: true, platform: true, direction: true } },
  assignedUser: { select: { id: true, name: true, email: true, role: true } },
  projects: { select: { id: true, name: true, status: true,
    contractors: { select: { contractor: { select: { id: true, name: true } } } } } },
} satisfies Prisma.LeadInclude;

function buildWhere(query: LeadListQuery): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = { archivedAt: query.archived === 'true' ? { not: null } : null };

  if (query.direction) where.direction = query.direction;
  if (query.stage) where.stage = query.stage;
  if (query.source) where.source = query.source;
  if (query.mappingStatus) where.mappingStatus = query.mappingStatus;
  if (query.campaignId) where.campaignId = query.campaignId;

  if (query.search) {
    const search = query.search;
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
      { normalizedPhone: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { normalizedEmail: { contains: search, mode: 'insensitive' } },
    ];
  }

  return where;
}

export async function listLeads(query: LeadListQuery): Promise<{ data: unknown[]; meta: PaginatedMeta }> {
  const pagination = resolvePagination(query);
  const where = buildWhere(query);

  const [data, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: leadInclude,
      orderBy: { createdAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.lead.count({ where }),
  ]);

  return { data, meta: buildMeta(pagination, total) };
}

export async function getLead(id: string) {
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: { ...leadInclude, events: { orderBy: { occurredAt: 'desc' } } },
  });

  if (!lead) throw notFound('Lead not found');
  return lead;
}

export async function createLead(input: CreateLeadInput) {
  const mappingStatus =
    input.mappingStatus ??
    (input.direction === 'UNCLASSIFIED' ? MappingStatus.NEEDS_REVIEW : MappingStatus.MAPPED);

  return prisma.lead.create({
    data: {
      externalLeadId: input.externalLeadId ?? null,
      name: input.name ?? null,
      phone: input.phone ?? null,
      normalizedPhone: normalizePhone(input.phone) ?? null,
      email: input.email ?? null,
      normalizedEmail: normalizeEmail(input.email) ?? null,
      propertyType: input.propertyType ?? null,
      propertyArea: input.propertyArea ?? null,
      bedrooms: input.bedrooms ?? null,
      serviceRaw: input.serviceRaw ?? null,
      direction: input.direction,
      stage: input.stage,
      source: input.source,
      mappingStatus,
      campaignId: input.campaignId ?? null,
      assignedUserId: input.assignedUserId ?? null,
      firstResponseAt: input.firstResponseAt ?? null,
      firstResponseDueAt: input.firstResponseDueAt ?? null,
      followUpDueAt: input.followUpDueAt ?? null,
      lostReason: input.lostReason ?? null,
      priority: input.priority ?? null,
      nextActionType: input.nextActionType ?? null,
      nextActionText: input.nextActionText ?? null,
      nextActionAt: input.nextActionAt ?? null,
      note: input.note ?? null,
      quotedAmount: input.quotedAmount == null ? null : new Prisma.Decimal(input.quotedAmount),
      agreedAmount: input.agreedAmount == null ? null : new Prisma.Decimal(input.agreedAmount),
      currency: input.currency,
      events: {
        create: [{ type: 'LEAD_CREATED', description: 'Lead created via API', metadata: { source: input.source } }],
      },
    },
    include: leadInclude,
  });
}

export async function updateLead(id: string, input: UpdateLeadInput) {
  const existing = await prisma.lead.findUnique({ where: { id }, select: { id: true, stage: true } });
  if (!existing) throw notFound('Lead not found');

  const data: Prisma.LeadUpdateInput = {};

  if ('externalLeadId' in input) data.externalLeadId = input.externalLeadId ?? null;
  if ('name' in input) data.name = input.name ?? null;
  if ('phone' in input) {
    data.phone = input.phone ?? null;
    data.normalizedPhone = normalizePhone(input.phone) ?? null;
  }
  if ('email' in input) {
    data.email = input.email ?? null;
    data.normalizedEmail = normalizeEmail(input.email) ?? null;
  }
  if ('propertyType' in input) data.propertyType = input.propertyType ?? null;
  if ('propertyArea' in input) data.propertyArea = input.propertyArea ?? null;
  if ('bedrooms' in input) data.bedrooms = input.bedrooms ?? null;
  if ('serviceRaw' in input) data.serviceRaw = input.serviceRaw ?? null;
  if (input.direction) data.direction = input.direction;
  if (input.stage) data.stage = input.stage;
  if (input.source) data.source = input.source;
  if (input.mappingStatus) data.mappingStatus = input.mappingStatus;
  if ('campaignId' in input) {
    data.campaign = input.campaignId ? { connect: { id: input.campaignId } } : { disconnect: true };
  }
  if ('assignedUserId' in input) {
    data.assignedUser = input.assignedUserId ? { connect: { id: input.assignedUserId } } : { disconnect: true };
  }
  if ('firstResponseAt' in input) data.firstResponseAt = input.firstResponseAt ?? null;
  if ('firstResponseDueAt' in input) data.firstResponseDueAt = input.firstResponseDueAt ?? null;
  if ('followUpDueAt' in input) data.followUpDueAt = input.followUpDueAt ?? null;
  if ('lostReason' in input) data.lostReason = input.lostReason ?? null;
  if ('priority' in input) data.priority = input.priority ?? null;
  if ('nextActionType' in input) data.nextActionType = input.nextActionType ?? null;
  if ('nextActionText' in input) data.nextActionText = input.nextActionText ?? null;
  if ('nextActionAt' in input) data.nextActionAt = input.nextActionAt ?? null;
  if ('note' in input) data.note = input.note ?? null;
  if ('quotedAmount' in input) data.quotedAmount = input.quotedAmount == null ? null : new Prisma.Decimal(input.quotedAmount);
  if ('agreedAmount' in input) data.agreedAmount = input.agreedAmount == null ? null : new Prisma.Decimal(input.agreedAmount);
  if (input.currency) data.currency = input.currency;

  const events: Prisma.LeadEventCreateWithoutLeadInput[] = [];
  if (input.stage && input.stage !== existing.stage) {
    events.push({
      type: 'STAGE_CHANGED',
      description: `Stage changed from ${existing.stage} to ${input.stage}`,
      metadata: { from: existing.stage, to: input.stage },
    });
  }
  if (input.assignedUserId) {
    events.push({
      type: 'ASSIGNED',
      description: 'Lead assigned',
      metadata: { assignedUserId: input.assignedUserId },
    });
  }
  if (events.length > 0) data.events = { create: events };

  return prisma.lead.update({ where: { id }, data, include: leadInclude });
}

export async function deleteLead(id: string): Promise<void> {
  const existing = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound('Lead not found');
  const [projects, properties, webhookEvents, attribution] = await Promise.all([
    prisma.serviceProject.count({ where: { OR: [{ ownerLeadId: id }, { sourceOpportunityId: id }] } }),
    prisma.property.count({ where: { ownerLeadId: id } }),
    prisma.webhookEvent.count({ where: { leadId: id } }),
    prisma.leadAttribution.count({ where: { leadId: id } }),
  ]);
  if (projects || properties || webhookEvents || attribution) throw conflict('Archive a lead with business history instead');

  await prisma.lead.delete({ where: { id } });
}

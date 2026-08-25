import { Prisma, type Campaign } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { notFound } from '../../plugins/error-handler.js';
import { buildMeta, resolvePagination, type PaginatedMeta } from '../../utils/pagination.js';
import type { CampaignListQuery, CreateCampaignInput, UpdateCampaignInput } from './campaign.schemas.js';

export interface CampaignDto extends Omit<Campaign, 'spendUsd'> {
  spendUsd: number;
}

function toDto(campaign: Campaign): CampaignDto {
  const { spendUsd, ...rest } = campaign;
  return { ...rest, spendUsd: Number(spendUsd) };
}

export async function listCampaigns(
  query: CampaignListQuery,
): Promise<{ data: CampaignDto[]; meta: PaginatedMeta }> {
  const pagination = resolvePagination(query);

  const where: Prisma.CampaignWhereInput = {};
  if (query.platform) where.platform = query.platform;
  if (query.direction) where.direction = query.direction;
  if (query.status) where.status = query.status;
  if (query.search) where.name = { contains: query.search, mode: 'insensitive' };

  const [campaigns, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.campaign.count({ where }),
  ]);

  return { data: campaigns.map(toDto), meta: buildMeta(pagination, total) };
}

export async function getCampaign(id: string): Promise<CampaignDto & { leadCount: number }> {
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: { _count: { select: { leads: true } } },
  });

  if (!campaign) throw notFound('Campaign not found');

  const { _count, ...rest } = campaign;
  return { ...toDto(rest), leadCount: _count.leads };
}

export async function createCampaign(input: CreateCampaignInput): Promise<CampaignDto> {
  const campaign = await prisma.campaign.create({
    data: {
      name: input.name,
      platform: input.platform,
      direction: input.direction,
      status: input.status,
      spendUsd: new Prisma.Decimal(input.spendUsd),
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      notes: input.notes ?? null,
    },
  });

  return toDto(campaign);
}

export async function updateCampaign(id: string, input: UpdateCampaignInput): Promise<CampaignDto> {
  const existing = await prisma.campaign.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound('Campaign not found');

  const data: Prisma.CampaignUpdateInput = {};
  if (input.name) data.name = input.name;
  if (input.platform) data.platform = input.platform;
  if (input.direction) data.direction = input.direction;
  if (input.status) data.status = input.status;
  if (input.spendUsd !== undefined) data.spendUsd = new Prisma.Decimal(input.spendUsd);
  if ('startsAt' in input) data.startsAt = input.startsAt ?? null;
  if ('endsAt' in input) data.endsAt = input.endsAt ?? null;
  if ('notes' in input) data.notes = input.notes ?? null;

  const campaign = await prisma.campaign.update({ where: { id }, data });
  return toDto(campaign);
}

export async function deleteCampaign(id: string): Promise<void> {
  const existing = await prisma.campaign.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound('Campaign not found');

  await prisma.campaign.delete({ where: { id } });
}

import type { FastifyInstance } from 'fastify';
import { requirePaterhausAccess } from '../../plugins/paterhaus-auth.js';
import { CampaignDirection, CampaignPlatform, CampaignStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { notFound } from '../../plugins/error-handler.js';
import { z } from 'zod';
import {
  campaignIdParamSchema,
  campaignListQuerySchema,
  createCampaignSchema,
  updateCampaignSchema,
} from './campaign.schemas.js';
import {
  createCampaign,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign,
} from './campaign.service.js';

const campaignTag = { tags: ['campaigns'] } as const;

const PLATFORMS = ['FACEBOOK', 'INSTAGRAM', 'GOOGLE', 'WHATSAPP', 'REFERRAL', 'OTHER'];
const DIRECTIONS = ['PROPERTY_MANAGEMENT', 'SNAGGING', 'STAGING'];
const STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED'];
const productionCampaignFields = z.object({
  name: z.string().trim().min(1).max(200), platform: z.nativeEnum(CampaignPlatform),
  direction: z.nativeEnum(CampaignDirection), status: z.nativeEnum(CampaignStatus).default('DRAFT'),
  spendAmount: z.coerce.number().finite().min(0).max(999999999999),
  currency: z.string().regex(/^[A-Z]{3}$/).default('AED'),
  startsAt: z.coerce.date().nullable().optional(), endsAt: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  objective: z.string().max(100).nullable().optional(),
  targetAudienceJson: z.string().max(5000).nullable().optional(),
  adCreativeUrl: z.string().url().nullable().optional(),
  impressions: z.coerce.number().int().min(0).nullable().optional(),
  clicks: z.coerce.number().int().min(0).nullable().optional(),
  reach: z.coerce.number().int().min(0).nullable().optional(),
  conversions: z.coerce.number().int().min(0).nullable().optional(),
  dailyBudget: z.coerce.number().finite().min(0).nullable().optional(),
  lifetimeBudget: z.coerce.number().finite().min(0).nullable().optional(),
  bidStrategy: z.string().max(50).nullable().optional(),
  externalCampaignId: z.string().max(200).nullable().optional(),
});
const validPeriod = (value: { startsAt?: Date | null; endsAt?: Date | null }) =>
  !value.startsAt || !value.endsAt || value.startsAt <= value.endsAt;
const productionCampaignInput = productionCampaignFields.refine(validPeriod,
  { message: 'Campaign end must not precede start', path: ['endsAt'] });

export async function campaignRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requirePaterhausAccess);
  app.get(
    '/campaigns',
    {
      schema: {
        ...campaignTag,
        summary: 'List campaigns',
        querystring: {
          type: 'object',
          properties: {
            platform: { type: 'string', enum: PLATFORMS },
            direction: { type: 'string', enum: DIRECTIONS },
            status: { type: 'string', enum: STATUSES },
            search: { type: 'string' },
            page: { type: 'integer', minimum: 1 },
            limit: { type: 'integer', minimum: 1, description: 'Page size; clamped to a maximum of 100' },
          },
        },
      },
    },
    async (request) => listCampaigns(campaignListQuerySchema.parse(request.query)),
  );

  app.get('/campaigns/:id', { schema: { ...campaignTag, summary: 'Get a campaign by id' } }, async (request) => {
    const { id } = campaignIdParamSchema.parse(request.params);
    return getCampaign(id);
  });

  app.post(
    '/campaigns',
    {
      schema: {
        ...campaignTag,
        summary: 'Create a campaign',
        body: {
          type: 'object',
          required: ['name', 'platform', 'direction', 'status'],
          properties: {
            name: { type: 'string', example: 'Dubai Marina - Property Management' },
            platform: { type: 'string', enum: PLATFORMS },
            direction: { type: 'string', enum: DIRECTIONS },
            status: { type: 'string', enum: STATUSES },
            spendUsd: { type: 'number', minimum: 0, example: 1500 },
            startsAt: { type: 'string', format: 'date-time' },
            endsAt: { type: 'string', format: 'date-time' },
            notes: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const input = createCampaignSchema.parse(request.body);
      const campaign = await createCampaign(input);
      return reply.status(201).send(campaign);
    },
  );

  app.patch(
    '/campaigns/:id',
    {
      schema: {
        ...campaignTag,
        summary: 'Update a campaign',
        body: { type: 'object', additionalProperties: true },
      },
    },
    async (request) => {
      const { id } = campaignIdParamSchema.parse(request.params);
      const input = updateCampaignSchema.parse(request.body);
      return updateCampaign(id, input);
    },
  );

  app.delete('/campaigns/:id', { schema: { ...campaignTag, summary: 'Delete a campaign' } }, async (request, reply) => {
    const { id } = campaignIdParamSchema.parse(request.params);
    await deleteCampaign(id);
    return reply.status(204).send();
  });

  app.post('/api/paterhaus/marketing/campaigns', async (request, reply) => {
    const input = productionCampaignInput.parse(request.body);
    return reply.code(201).send(await prisma.campaign.create({ data: {
      ...input,
      spendAmount: new Prisma.Decimal(input.spendAmount),
      spendUsd: new Prisma.Decimal(0),
      dailyBudget: input.dailyBudget != null ? new Prisma.Decimal(input.dailyBudget) : null,
      lifetimeBudget: input.lifetimeBudget != null ? new Prisma.Decimal(input.lifetimeBudget) : null,
    } }));
  });
  app.patch('/api/paterhaus/marketing/campaigns/:id', async (request) => {
    const { id } = campaignIdParamSchema.parse(request.params);
    const existing = await prisma.campaign.findUnique({ where: { id } });
    if (!existing) throw notFound('Campaign not found');
    const input = productionCampaignFields.partial().parse(request.body);
    productionCampaignInput.parse({ ...existing, ...input,
      currency: input.currency ?? existing.currency ?? 'USD',
      spendAmount: input.spendAmount ?? existing.spendAmount?.toNumber() ?? existing.spendUsd.toNumber() });
    return prisma.campaign.update({ where: { id }, data: {
      ...input,
      ...(input.spendAmount !== undefined ? { spendAmount: new Prisma.Decimal(input.spendAmount) } : {}),
      ...(('dailyBudget' in input) ? { dailyBudget: input.dailyBudget != null ? new Prisma.Decimal(input.dailyBudget) : null } : {}),
      ...(('lifetimeBudget' in input) ? { lifetimeBudget: input.lifetimeBudget != null ? new Prisma.Decimal(input.lifetimeBudget) : null } : {}),
    } });
  });
  app.patch('/api/paterhaus/marketing/campaigns/:id/archive', async (request) => {
    const { id } = campaignIdParamSchema.parse(request.params);
    const { archived } = z.object({ archived: z.boolean() }).parse(request.body);
    if (!(await prisma.campaign.count({ where: { id } }))) throw notFound('Campaign not found');
    return prisma.campaign.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
  });
}

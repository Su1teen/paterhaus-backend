import type { FastifyInstance } from 'fastify';
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

export async function campaignRoutes(app: FastifyInstance): Promise<void> {
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
}

import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';

export async function registerSwagger(app: FastifyInstance): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Paterhaus Backend API',
        description:
          'Backend API for the Paterhaus Dubai property-management CRM. Handles lead intake from the ' +
          'Paterhaus Meta connector, leads, campaigns and integration diagnostics.',
        version: '0.1.0',
      },
      tags: [
        { name: 'health', description: 'Service health' },
        { name: 'webhooks', description: 'Inbound webhook intake' },
        { name: 'leads', description: 'Lead management' },
        { name: 'campaigns', description: 'Marketing campaigns' },
        { name: 'integrations', description: 'Integration review and diagnostics' },
      ],
      components: {
        securitySchemes: {
          webhookBearer: {
            type: 'http',
            scheme: 'bearer',
            description: 'Shared webhook secret provided as `Authorization: Bearer <WEBHOOK_SECRET>`.',
          },
        },
      },
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });
}

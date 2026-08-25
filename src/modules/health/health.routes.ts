import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';

const SERVICE_NAME = 'paterhaus-backend';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Service and database health',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', example: 'ok' },
              service: { type: 'string', example: SERVICE_NAME },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
          503: {
            type: 'object',
            properties: {
              status: { type: 'string', example: 'error' },
              service: { type: 'string', example: SERVICE_NAME },
              timestamp: { type: 'string', format: 'date-time' },
              message: { type: 'string', example: 'Database unavailable' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return {
          status: 'ok',
          service: SERVICE_NAME,
          timestamp: new Date().toISOString(),
        };
      } catch {
        request.log.error('Health check failed: database unavailable');
        return reply.status(503).send({
          status: 'error',
          service: SERVICE_NAME,
          timestamp: new Date().toISOString(),
          message: 'Database unavailable',
        });
      }
    },
  );
}

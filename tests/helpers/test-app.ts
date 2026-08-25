import type { FastifyInstance } from 'fastify';

export const TEST_WEBHOOK_SECRET = 'test_webhook_secret_value_0123456789';
export const TEST_DASHBOARD_SECRET = 'test_dashboard_secret_value_0123456789';
export const TEST_CONNECTOR_TOKEN = 'test_connector_token_value_0123456789';
export const TEST_CORS_ORIGIN = 'http://localhost:5173';

process.env.NODE_ENV = 'test';
process.env.WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
process.env.INTERNAL_DASHBOARD_SECRET = TEST_DASHBOARD_SECRET;
process.env.CONNECTOR_WEBHOOK_TOKEN = TEST_CONNECTOR_TOKEN;
process.env.CORS_ORIGIN = TEST_CORS_ORIGIN;
process.env.LOG_LEVEL = 'silent';

let app: FastifyInstance | undefined;

export async function getTestApp(): Promise<FastifyInstance> {
  if (!app) {
    const { buildApp } = await import('../../src/app.js');
    app = await buildApp();
    await app.ready();
  }
  return app;
}

export async function closeTestApp(): Promise<void> {
  if (app) {
    await app.close();
    app = undefined;
  }
}

export async function resetDatabase(): Promise<void> {
  const { prisma } = await import('../../src/lib/prisma.js');
  await prisma.leadEvent.deleteMany();
  await prisma.leadAttribution.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.integrationMapping.deleteMany();
  await prisma.user.deleteMany();
}

export async function seedServiceMappings(): Promise<void> {
  const { prisma } = await import('../../src/lib/prisma.js');
  await prisma.integrationMapping.createMany({
    data: [
      {
        provider: 'paterhaus_meta_connector',
        sourceField: 'service',
        sourceValue: 'Property Management',
        targetField: 'direction',
        targetValue: 'PROPERTY_MANAGEMENT',
      },
      {
        provider: 'paterhaus_meta_connector',
        sourceField: 'service',
        sourceValue: 'Snagging',
        targetField: 'direction',
        targetValue: 'SNAGGING',
      },
      {
        provider: 'paterhaus_meta_connector',
        sourceField: 'service',
        sourceValue: 'Staging',
        targetField: 'direction',
        targetValue: 'STAGING',
      },
    ],
  });
}

export function webhookHeaders(secret: string = TEST_WEBHOOK_SECRET): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${secret}`,
  };
}

import type { FastifyInstance } from 'fastify';
import type { InjectOptions } from 'light-my-request';
import { scryptSync } from 'node:crypto';

export const TEST_WEBHOOK_SECRET = 'test_webhook_secret_value_0123456789';
export const TEST_DASHBOARD_SECRET = 'test_dashboard_secret_value_0123456789';
export const TEST_CONNECTOR_TOKEN = 'test_connector_token_value_0123456789';
export const TEST_CORS_ORIGIN = 'http://localhost:5173';

process.env.NODE_ENV = 'test';
process.env.CHAT_HISTORY_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/paterhaus_chat_history_test';
process.env.CRM_JWT_SECRET = 'test_crm_jwt_secret_value_0123456789';
process.env.CRM_ALLOWED_EMAILS = 'info@paterhaus.com,r_tszi@paterhaus.com';
const salt = 'ab'.repeat(16);
const testHash = `scrypt:${salt}:${scryptSync('test-password', Buffer.from(salt, 'hex'), 64).toString('hex')}`;
process.env.PATERHAUS_ADMIN_PASSWORD_HASH = testHash;
process.env.PATERHAUS_MARKETING_PASSWORD_HASH = testHash;
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

export async function getAuthenticatedTestApp(role: 'ADMIN' | 'MARKETING' = 'ADMIN') {
  const instance = await getTestApp();
  const email = role === 'ADMIN' ? 'info@paterhaus.com' : 'r_tszi@paterhaus.com';
  const login = await instance.inject({ method: 'POST', url: '/api/paterhaus/auth/login',
    payload: { email, password: 'test-password' } });
  if (login.statusCode !== 200) throw new Error('Test account login failed');
  const token = login.json<{ accessToken: string }>().accessToken;
  return {
    inject: (options: InjectOptions) => instance.inject({
      ...options,
      headers: { ...options.headers, authorization: `Bearer ${token}` },
    }),
  };
}

export async function closeTestApp(): Promise<void> {
  if (app) {
    await app.close();
    app = undefined;
  }
}

export async function resetDatabase(): Promise<void> {
  const { prisma } = await import('../../src/lib/prisma.js');
  await prisma.internalDocument.deleteMany();
  await prisma.projectPayment.deleteMany();
  await prisma.projectMilestone.deleteMany();
  await prisma.projectContractorAssignment.deleteMany();
  await prisma.serviceProject.deleteMany();
  await prisma.stay.deleteMany();
  await prisma.guest.deleteMany();
  await prisma.property.deleteMany();
  await prisma.contractor.deleteMany();
  await prisma.leadEvent.deleteMany();
  await prisma.leadAttribution.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.integrationMapping.deleteMany();
  await prisma.user.deleteMany();
  await prisma.calendarEvent.deleteMany();
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

import { defineConfig } from 'vitest/config';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/paterhaus_test';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/helpers/global-setup.ts'],
    fileParallelism: false,
    hookTimeout: 60000,
    testTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      WEBHOOK_SECRET: 'test_webhook_secret_value_0123456789',
      INTERNAL_DASHBOARD_SECRET: 'test_dashboard_secret_value_0123456789',
      CORS_ORIGIN: 'http://localhost:5173',
      LOG_LEVEL: 'silent',
    },
  },
});

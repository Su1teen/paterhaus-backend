import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/attachments.test.ts',
      'tests/conversations.test.ts',
      'tests/chat-history-migrations.test.ts',
    ],
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/paterhaus_test',
      CHAT_HISTORY_DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/paterhaus_chat_history_test',
      CRM_JWT_SECRET: 'test_crm_jwt_secret_value_0123456789',
      CRM_ALLOWED_EMAILS: 'info@paterhaus.com,r_tszi@paterhaus.com',
      WEBHOOK_SECRET: 'test_webhook_secret_value_0123456789',
      INTERNAL_DASHBOARD_SECRET: 'test_dashboard_secret_value_0123456789',
      CONNECTOR_WEBHOOK_TOKEN: 'test_connector_token_value_0123456789',
      CORS_ORIGIN: 'http://localhost:5173',
      LOG_LEVEL: 'silent',
    },
  },
});

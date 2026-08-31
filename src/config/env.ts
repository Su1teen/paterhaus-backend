import { z } from 'zod';

const PATERHAUS_CRM_PRODUCTION_ORIGIN = 'https://prestige-crm-production.up.railway.app';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  CHAT_HISTORY_DATABASE_URL: z.string().min(1, 'CHAT_HISTORY_DATABASE_URL is required'),
  CRM_JWT_SECRET: z.string().min(32, 'CRM_JWT_SECRET must be at least 32 characters'),
  CRM_ALLOWED_EMAILS: z.string().min(1, 'CRM_ALLOWED_EMAILS is required'),
  WEBHOOK_SECRET: z.string().min(1, 'WEBHOOK_SECRET is required'),
  INTERNAL_DASHBOARD_SECRET: z.string().min(1, 'INTERNAL_DASHBOARD_SECRET is required'),
  // Optional: when unset/empty, the legacy GET connector adapter rejects every request with 401.
  CONNECTOR_WEBHOOK_TOKEN: z.string().default(''),
  // Optional: protected n8n webhook that forwards human takeover replies to WAHA.
  // When unset, manual replies are reported as unsupported instead of failing silently.
  N8N_OUTBOUND_WEBHOOK_URL: z
    .string()
    .trim()
    .url('N8N_OUTBOUND_WEBHOOK_URL must be a valid URL')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  N8N_OUTBOUND_WEBHOOK_TOKEN: z.string().default(''),
  // Optional override for the lead classification table in the chat-history database.
  // When unset, the table is discovered from its column signature.
  LEAD_CLASSIFICATIONS_TABLE: z.string().trim().default(''),
  CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN is required'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema> & {
  corsOrigins: string[];
  crmAllowedEmails: ReadonlySet<string>;
  manualRepliesEnabled: boolean;
};

function buildEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${missing.join('\n')}`);
  }

  const configuredCorsOrigins = parsed.data.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (configuredCorsOrigins.length === 0) {
    throw new Error('Invalid environment configuration:\nCORS_ORIGIN: at least one origin is required');
  }

  const corsOrigins = Array.from(
    new Set([...configuredCorsOrigins, PATERHAUS_CRM_PRODUCTION_ORIGIN]),
  );

  const crmAllowedEmails = new Set(
    parsed.data.CRM_ALLOWED_EMAILS.split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );

  if (crmAllowedEmails.size === 0) {
    throw new Error('Invalid environment configuration:\nCRM_ALLOWED_EMAILS: at least one email is required');
  }

  return {
    ...parsed.data,
    corsOrigins,
    crmAllowedEmails,
    manualRepliesEnabled: Boolean(parsed.data.N8N_OUTBOUND_WEBHOOK_URL),
  };
}

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) {
    cached = buildEnv();
  }
  return cached;
}

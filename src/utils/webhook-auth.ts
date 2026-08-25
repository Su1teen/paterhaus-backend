import { timingSafeEqual } from 'node:crypto';

export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Extracts the bearer token from an Authorization header value, if well formed. */
export function extractBearerToken(header: unknown): string | undefined {
  if (typeof header !== 'string') return undefined;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : undefined;
}

export function isValidWebhookAuth(header: unknown, expectedSecret: string): boolean {
  const token = extractBearerToken(header);
  if (!token) return false;
  return safeCompare(token, expectedSecret);
}

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-webhook-secret',
  'x-hub-signature',
  'x-hub-signature-256',
]);

/** Keeps only non-sensitive request headers so webhook metadata can be persisted safely. */
export function redactHeaders(headers: Record<string, unknown>): Record<string, string> {
  const safe: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_HEADERS.has(lowerKey)) continue;
    if (value === undefined || value === null) continue;
    safe[lowerKey] = Array.isArray(value) ? value.join(', ') : String(value);
  }

  return safe;
}

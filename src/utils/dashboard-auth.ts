import { safeCompare } from './webhook-auth.js';

export function isValidDashboardToken(token: unknown, expectedSecret: string): boolean {
  if (typeof token !== 'string' || token.length === 0) return false;
  return safeCompare(token, expectedSecret);
}

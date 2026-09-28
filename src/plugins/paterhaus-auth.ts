import { scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { HttpError, forbidden, serviceUnavailable, unauthorized } from './error-handler.js';

const deriveKey = promisify(scrypt);
const SESSION_FEATURE = 'paterhaus-session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
export type PaterhausRole = 'ADMIN' | 'MARKETING';

const credentials = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(1024),
});

function account(email: string): { role: PaterhausRole; hash?: string } | null {
  const env = getEnv();
  if (email === 'info@paterhaus.com') return { role: 'ADMIN', hash: env.PATERHAUS_ADMIN_PASSWORD_HASH };
  if (email === 'r_tszi@paterhaus.com') return { role: 'MARKETING', hash: env.PATERHAUS_MARKETING_PASSWORD_HASH };
  return null;
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const match = /^scrypt:([a-f0-9]{32,128}):([a-f0-9]{128})$/.exec(encoded);
  if (!match) return false;
  const expected = Buffer.from(match[2]!, 'hex');
  const derived = (await deriveKey(password, Buffer.from(match[1]!, 'hex'), expected.length)) as Buffer;
  return timingSafeEqual(expected, derived);
}

function secret(): Uint8Array {
  return new TextEncoder().encode(getEnv().CRM_JWT_SECRET);
}

export async function requirePaterhausAccess(request: FastifyRequest): Promise<void> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) throw unauthorized();
  let payload;
  try {
    ({ payload } = await jwtVerify(authorization.slice(7), secret(), { algorithms: ['HS256'] }));
  } catch {
    throw unauthorized();
  }
  if (payload.feature !== SESSION_FEATURE || typeof payload.sub !== 'string' ||
      (payload.role !== 'ADMIN' && payload.role !== 'MARKETING')) throw unauthorized();
  const found = account(payload.sub);
  if (!found || found.role !== payload.role || !found.hash) throw unauthorized();
  request.paterhausUser = { email: payload.sub, role: found.role };
}

export async function requirePaterhausAdmin(request: FastifyRequest): Promise<void> {
  await requirePaterhausAccess(request);
  if (request.paterhausUser?.role !== 'ADMIN') throw forbidden();
}

export async function paterhausAuthRoutes(app: FastifyInstance): Promise<void> {
  const failures = new Map<string, { count: number; until: number }>();
  app.post('/api/paterhaus/auth/login', {
    schema: {
      tags: ['paterhaus-auth'],
      body: { type: 'object', required: ['email', 'password'], additionalProperties: false,
        properties: { email: { type: 'string' }, password: { type: 'string' } } },
    },
  }, async (request) => {
    const { email, password } = credentials.parse(request.body);
    const key = request.ip;
    const now = Date.now();
    const attempts = failures.get(key);
    if (attempts && attempts.until > now && attempts.count >= 10) throw new HttpError(429, 'Try again later');
    const found = account(email);
    if (found && !found.hash) throw serviceUnavailable('Paterhaus login is not configured');
    const valid = await verifyPassword(password, found?.hash ?? '');
    if (!found || !valid) {
      if (failures.size > 5000) failures.clear();
      failures.set(key, { count: attempts && attempts.until > now ? attempts.count + 1 : 1, until: now + 900_000 });
      throw unauthorized('Invalid email or password');
    }
    failures.delete(key);
    const accessToken = await new SignJWT({ feature: SESSION_FEATURE, role: found.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(email)
      .setIssuedAt()
      .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
      .sign(secret());
    return { accessToken, expiresIn: SESSION_TTL_SECONDS, user: { email, role: found.role } };
  });

  app.get('/api/paterhaus/auth/me', { preHandler: requirePaterhausAccess }, async (request) => request.paterhausUser);
}

declare module 'fastify' {
  interface FastifyRequest {
    paterhausUser?: { email: string; role: PaterhausRole };
  }
}

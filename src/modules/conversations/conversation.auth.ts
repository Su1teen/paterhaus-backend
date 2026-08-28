import type { FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { getEnv } from '../../config/env.js';
import { forbidden, unauthorized } from '../../plugins/error-handler.js';

const TOKEN_TTL_SECONDS = 900;
const FEATURE = 'paterhaus-conversations';

function normalizedAllowedEmail(email: string): boolean {
  return getEnv().crmAllowedEmails.has(email.trim().toLowerCase());
}

function jwtSecret(): Uint8Array {
  return new TextEncoder().encode(getEnv().CRM_JWT_SECRET);
}

export async function issueConversationAccessToken(email: string): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedAllowedEmail(normalizedEmail)) throw forbidden('Account is not allowed to access live conversations');

  const accessToken = await new SignJWT({ email: normalizedEmail, feature: FEATURE })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(normalizedEmail)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(jwtSecret());

  return { accessToken, expiresIn: TOKEN_TTL_SECONDS };
}

export async function requireConversationAccess(request: FastifyRequest): Promise<void> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) throw unauthorized();

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) throw unauthorized();

  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwtSecret(), { algorithms: ['HS256'] }));
  } catch {
    throw unauthorized();
  }

  if (
    payload.feature !== FEATURE ||
    typeof payload.sub !== 'string' ||
    typeof payload.email !== 'string'
  ) {
    throw unauthorized();
  }

  const email = payload.sub.trim().toLowerCase();
  if (payload.email.trim().toLowerCase() !== email) throw unauthorized();
  if (!normalizedAllowedEmail(email)) throw forbidden('Account is not allowed to access live conversations');
  request.conversationAccessEmail = email;
}

declare module 'fastify' {
  interface FastifyRequest {
    conversationAccessEmail?: string;
  }
}

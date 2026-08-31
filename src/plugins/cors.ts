import fastifyCors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import { getEnv } from '../config/env.js';

export async function registerCors(app: FastifyInstance): Promise<void> {
  const { corsOrigins } = getEnv();

  await app.register(fastifyCors, {
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    credentials: false,
    maxAge: 86400,
  });
}

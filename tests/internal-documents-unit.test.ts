import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { matchesFileType } from '../src/modules/internal-documents/internal-document.routes.js';

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });

describe('private internal documents', () => {
  it('rejects public and marketing access to files and uploads before storage or database access', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/paterhaus/internal-documents' })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/paterhaus/auth/login',
      payload: { email: 'r_tszi@paterhaus.com', password: 'test-password' } });
    const headers = { authorization: `Bearer ${login.json().accessToken}` };
    expect((await app.inject({ method: 'GET', url: '/api/paterhaus/internal-documents', headers })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/paterhaus/internal-documents', headers: {
      ...headers, 'content-type': 'application/octet-stream' }, payload: Buffer.from('%PDF-1.0') })).statusCode).toBe(403);
  });

  it('validates file signatures rather than trusting only client MIME headers', () => {
    expect(matchesFileType(Buffer.from('%PDF-1.7'), 'application/pdf')).toBe(true);
    expect(matchesFileType(Buffer.from('not a pdf'), 'application/pdf')).toBe(false);
    expect(matchesFileType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png')).toBe(true);
    expect(matchesFileType(Buffer.from([0, 1, 2]), 'text/plain')).toBe(false);
  });
});

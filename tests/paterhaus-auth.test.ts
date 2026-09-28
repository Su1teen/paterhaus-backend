import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });

async function login(email: string, password = 'test-password') {
  return app.inject({ method: 'POST', url: '/api/paterhaus/auth/login', payload: { email, password } });
}

describe('Paterhaus server-side authentication and RBAC', () => {
  it('rejects wrong credentials and unknown accounts without issuing a token', async () => {
    expect((await login('info@paterhaus.com', 'wrong')).statusCode).toBe(401);
    expect((await login('outsider@example.com')).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/paterhaus/auth/me' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/campaigns' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/paterhaus/conversations/access-token', payload: { email: 'info@paterhaus.com' } })).statusCode).toBe(401);
  });

  it('issues role-bound sessions; marketing cannot access admin-only integrations', async () => {
    const response = await login(' R_Tszi@paterhaus.com ');
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toEqual({ email: 'r_tszi@paterhaus.com', role: 'MARKETING' });
    const headers = { authorization: `Bearer ${response.json().accessToken}` };
    expect((await app.inject({ method: 'GET', url: '/api/paterhaus/auth/me', headers })).json()).toEqual(response.json().user);
    expect((await app.inject({ method: 'GET', url: '/integrations/mappings', headers })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/paterhaus/conversations/access-token', headers,
      payload: { email: 'info@paterhaus.com' } })).statusCode).toBe(200);
  });

  it('allows admin into protected operational routes but rejects a feature token as a session', async () => {
    const response = await login('info@paterhaus.com');
    expect(response.statusCode).toBe(200);
    const headers = { authorization: `Bearer ${response.json().accessToken}` };
    expect((await app.inject({ method: 'GET', url: '/api/paterhaus/auth/me', headers })).json().role).toBe('ADMIN');
    const bridge = await app.inject({ method: 'POST', url: '/api/paterhaus/conversations/access-token', headers });
    expect(bridge.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/paterhaus/auth/me', headers: {
      authorization: `Bearer ${bridge.json().accessToken}`,
    } })).statusCode).toBe(401);
  });
});

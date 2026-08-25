import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestApp, getTestApp } from './helpers/test-app.js';

describe('GET /health', () => {
  beforeAll(async () => {
    await getTestApp();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  it('reports ok when the database is reachable', async () => {
    const app = await getTestApp();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('paterhaus-backend');
    expect(typeof body.timestamp).toBe('string');
  });

  it('does not leak connection details', async () => {
    const app = await getTestApp();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.body).not.toContain('postgresql://');
    expect(response.body).not.toContain('DATABASE_URL');
  });
});

import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { projectMoney } from '../src/modules/operations/operations.money.js';
import { marketingMetrics } from '../src/modules/operations/operations.analytics.js';
import { leadListQuerySchema } from '../src/modules/leads/lead.schemas.js';
import { contractorInput, paymentInput, projectInput, stayInput } from '../src/modules/operations/operations.schemas.js';

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });

describe('Production operations domain', () => {
  it('uses nullable prices and exact Decimal payment calculations including refunds', () => {
    const money = projectMoney({
      quotedAmount: null, agreedAmount: new Prisma.Decimal('10500.00'), currency: 'AED', payments: [
        { amount: new Prisma.Decimal('3000.10'), currency: 'AED', type: 'PREPAYMENT', status: 'PAID', paidAt: new Date() },
        { amount: new Prisma.Decimal('50.05'), currency: 'AED', type: 'REFUND', status: 'PAID', paidAt: new Date() },
        { amount: new Prisma.Decimal('1000.00'), currency: 'AED', type: 'PARTIAL', status: 'PENDING', paidAt: null },
      ],
    });
    expect(money).toEqual({ quoted: null, agreed: '10500.00', currency: 'AED', paid: '2950.05', outstanding: '7549.95' });
    expect(projectMoney({ quotedAmount: null, agreedAmount: null, currency: 'AED', payments: [] }).outstanding).toBeNull();
  });

  it('rejects invalid payments, project amounts, contractor services and stay dates', () => {
    expect(paymentInput.safeParse({ amount: -1, type: 'PREPAYMENT', paidAt: new Date() }).success).toBe(false);
    expect(paymentInput.safeParse({ amount: 50, type: 'PREPAYMENT' }).success).toBe(false);
    expect(projectInput.safeParse({ name: 'Snagging', serviceDirections: ['SNAGGING'], agreedAmount: -1 }).success).toBe(false);
    expect(contractorInput.safeParse({ name: 'Supplier', serviceTypes: ['SNAGGING', 'SNAGGING'] }).success).toBe(false);
    expect(stayInput.safeParse({ propertyId: '00000000-0000-4000-8000-000000000000', guestId: '00000000-0000-4000-8000-000000000001', checkIn: '2026-10-10', checkOut: '2026-10-09' }).success).toBe(false);
  });

  it('computes actual marketing conversions without mixing currencies or inventing CPL', () => {
    const leads = [
      { campaignId: 'campaign-1', direction: 'SNAGGING' as const, source: 'MANUAL' as const, stage: 'qualified' },
      { campaignId: 'campaign-1', direction: 'SNAGGING' as const, source: 'MANUAL' as const, stage: 'won' },
      { campaignId: null, direction: 'STAGING' as const, source: 'WHATSAPP' as const, stage: 'new' },
    ];
    const campaigns = [
      { id: 'campaign-1', name: 'Snagging', platform: 'INSTAGRAM' as const, direction: 'SNAGGING' as const,
        currency: 'AED', spendAmount: new Prisma.Decimal('200.00'), spendUsd: new Prisma.Decimal(0) },
      { id: 'campaign-2', name: 'Historical', platform: 'GOOGLE' as const, direction: 'STAGING' as const,
        currency: null, spendAmount: null, spendUsd: new Prisma.Decimal('50.00') },
    ];
    const result = marketingMetrics(leads, campaigns);
    expect(result.spend).toEqual({ AED: '200.00', USD: '50.00' });
    expect(result.cpl).toEqual({ AED: '100.00', USD: '25.00' });
    expect(result.qualifiedToProposal).toBe(0.5);
    expect(result.byDirection.SNAGGING?.signed).toBe(1);
    expect(marketingMetrics([], campaigns).cpl).toBeNull();
    expect(leadListQuerySchema.parse({ archived: 'true' }).archived).toBe('true');
  });

  it('denies operations to marketing and anonymous clients before touching the database', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/paterhaus/projects' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/paterhaus/users' })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/paterhaus/auth/login',
      payload: { email: 'r_tszi@paterhaus.com', password: 'test-password' } });
    const headers = { authorization: `Bearer ${login.json().accessToken}` };
    for (const path of ['/api/paterhaus/projects', '/api/paterhaus/properties', '/api/paterhaus/contractors', '/api/paterhaus/guests', '/api/paterhaus/stays']) {
      expect((await app.inject({ method: 'GET', url: path, headers })).statusCode).toBe(403);
    }
  });
});

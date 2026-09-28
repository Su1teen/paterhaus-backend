import { Prisma, type Campaign, type Lead } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { requirePaterhausAccess, requirePaterhausAdmin } from '../../plugins/paterhaus-auth.js';
import { netPayments, projectMoney } from './operations.money.js';

export function addMoney(totals: Record<string, Prisma.Decimal>, currency: string, amount: Prisma.Decimal) {
  totals[currency] = (totals[currency] ?? new Prisma.Decimal(0)).plus(amount);
}

export function serializeMoney(totals: Record<string, Prisma.Decimal>): Record<string, string> {
  return Object.fromEntries(Object.entries(totals).map(([currency, amount]) => [currency, amount.toFixed(2)]));
}

function monthBounds(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dubai', year: 'numeric', month: 'numeric' }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  return [new Date(Date.UTC(year, month - 1, 1, -4)), new Date(Date.UTC(year, month, 1, -4))] as const;
}

export function marketingMetrics(
  leads: readonly Pick<Lead, 'campaignId' | 'direction' | 'source' | 'stage'>[],
  campaigns: readonly Pick<Campaign, 'id' | 'name' | 'platform' | 'direction' | 'spendAmount' | 'spendUsd' | 'currency'>[],
) {
  const spend: Record<string, Prisma.Decimal> = {};
  const isQualified = (stage: string) => ['qualified', 'proposal', 'negotiation', 'won'].includes(stage.toLowerCase());
  const isProposal = (stage: string) => ['proposal', 'negotiation', 'won'].includes(stage.toLowerCase());
  const isSigned = (stage: string) => stage.toLowerCase() === 'won';
  const byCampaign = campaigns.map((campaign) => {
    const currency = campaign.spendAmount === null ? 'USD' : (campaign.currency ?? 'AED');
    const amount = campaign.spendAmount ?? campaign.spendUsd;
    addMoney(spend, currency, amount);
    const attributable = leads.filter((lead) => lead.campaignId === campaign.id);
    return { id: campaign.id, name: campaign.name, platform: campaign.platform,
      direction: campaign.direction, currency, spend: amount.toFixed(2), leads: attributable.length,
      qualified: attributable.filter((lead) => isQualified(lead.stage)).length,
      proposals: attributable.filter((lead) => isProposal(lead.stage)).length,
      signed: attributable.filter((lead) => isSigned(lead.stage)).length };
  });
  const qualified = leads.filter((lead) => isQualified(lead.stage));
  const proposals = leads.filter((lead) => isProposal(lead.stage));
  const signed = leads.filter((lead) => isSigned(lead.stage));
  const attributableCount = leads.filter((lead) => lead.campaignId).length;
  const perCurrency = (denominator: number) => denominator ? Object.fromEntries(Object.entries(spend).map(([currency, amount]) =>
    [currency, amount.dividedBy(denominator).toFixed(2)])) : null;
  const breakdown = (key: 'source' | 'direction') => Object.fromEntries(
    [...new Set(leads.map((lead) => lead[key]))].map((value) => [value, {
      leads: leads.filter((lead) => lead[key] === value).length,
      qualified: qualified.filter((lead) => lead[key] === value).length,
      signed: signed.filter((lead) => lead[key] === value).length,
    }]),
  );
  return { spend: serializeMoney(spend), leads: leads.length, qualified: qualified.length,
    proposals: proposals.length, signed: signed.length, cpl: perCurrency(attributableCount),
    costPerQualified: perCurrency(qualified.length), costPerSigned: perCurrency(signed.length),
    leadToQualified: leads.length ? qualified.length / leads.length : null,
    qualifiedToProposal: qualified.length ? proposals.length / qualified.length : null,
    proposalToSigned: proposals.length ? signed.length / proposals.length : null,
    byCampaign, bySource: breakdown('source'), byDirection: breakdown('direction') };
}

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/paterhaus/marketing/overview', { preHandler: requirePaterhausAccess }, async () => {
    const [leads, campaigns] = await Promise.all([
      prisma.lead.findMany({ select: { campaignId: true, direction: true, source: true, stage: true } }),
      prisma.campaign.findMany({ select: { id: true, name: true, direction: true, platform: true,
        spendAmount: true, spendUsd: true, currency: true } }),
    ]);
    return marketingMetrics(leads, campaigns);
  });
  app.get('/api/paterhaus/analytics/overview', { preHandler: requirePaterhausAdmin }, async () => {
    const now = new Date();
    const [start, end] = monthBounds(now);
    const [leads, projects, campaigns, stays, stageEvents] = await Promise.all([
      prisma.lead.findMany({ select: { id: true, createdAt: true, stage: true, archivedAt: true, nextActionAt: true,
        agreedAmount: true, quotedAmount: true, currency: true, direction: true, source: true, campaignId: true } }),
      prisma.serviceProject.findMany({ include: { payments: true, contractors: true } }),
      prisma.campaign.findMany({ select: { id: true, name: true, direction: true, platform: true,
        spendAmount: true, spendUsd: true, currency: true, archivedAt: true } }),
      prisma.stay.findMany({ select: { status: true, checkIn: true, checkOut: true,
        bookingValue: true, currency: true } }),
      prisma.leadEvent.findMany({ where: { type: 'STAGE_CHANGED', occurredAt: { gte: start, lt: end } },
        select: { leadId: true, metadata: true } }),
    ]);
    const pipelineValue: Record<string, Prisma.Decimal> = {};
    const contractedValue: Record<string, Prisma.Decimal> = {};
    const revenueCollected: Record<string, Prisma.Decimal> = {};
    const outstanding: Record<string, Prisma.Decimal> = {};
    const depositsReceived: Record<string, Prisma.Decimal> = {};
    const revenueByService: Record<string, Record<string, Prisma.Decimal>> = {};
    for (const lead of leads) {
      if (lead.archivedAt || ['lost', 'won'].includes(lead.stage.toLowerCase())) continue;
      const amount = lead.agreedAmount ?? lead.quotedAmount;
      if (amount) addMoney(pipelineValue, lead.currency, amount);
    }
    for (const project of projects) {
      if (project.confirmedAt && project.confirmedAt >= start && project.confirmedAt < end && project.agreedAmount) {
        addMoney(contractedValue, project.currency, project.agreedAmount);
      }
      for (const payment of project.payments) {
        if (payment.status !== 'PAID' || !payment.paidAt || payment.paidAt < start || payment.paidAt >= end) continue;
        const amount = payment.type === 'REFUND' ? payment.amount.negated() : payment.amount;
        addMoney(revenueCollected, payment.currency, amount);
        if (payment.type === 'PREPAYMENT') addMoney(depositsReceived, payment.currency, payment.amount);
        const service = project.serviceDirections.join(' + ') || 'UNSPECIFIED';
        const byCurrency = revenueByService[service] ??= {};
        addMoney(byCurrency, payment.currency, amount);
      }
      if (!project.archivedAt && !['CANCELLED', 'COMPLETED'].includes(project.status) && project.agreedAmount) {
        addMoney(outstanding, project.currency, Prisma.Decimal.max(project.agreedAmount.minus(netPayments(project.payments, project.currency)), 0));
      }
    }
    const active = projects.filter((project) => !project.archivedAt && !['COMPLETED', 'CANCELLED'].includes(project.status));
    const marketing = marketingMetrics(leads, campaigns);
    const signedThisMonth = new Set(stageEvents.filter((event) =>
      (event.metadata as { to?: unknown } | null)?.to === 'won').map((event) => event.leadId));
    for (const lead of leads) {
      if (lead.stage.toLowerCase() === 'won' && lead.createdAt >= start && lead.createdAt < end) signedThisMonth.add(lead.id);
    }
    const byService = Object.fromEntries(Object.entries(revenueByService).map(([service, values]) => [service, serializeMoney(values)]));
    const breakdown = Object.fromEntries([...new Set(active.flatMap((project) => project.serviceDirections))].map((service) =>
      [service, active.filter((project) => project.serviceDirections.includes(service)).length]));
    return {
      period: { from: start.toISOString(), to: end.toISOString(), timeZone: 'Asia/Dubai' },
      sales: { newLeads: leads.filter((lead) => lead.createdAt >= start && lead.createdAt < end).length,
        qualifiedLeads: marketing.qualified, activeOpportunities: leads.filter((lead) =>
          !lead.archivedAt && !['lost', 'won'].includes(lead.stage.toLowerCase())).length,
        overdueFollowUps: leads.filter((lead) => !lead.archivedAt && lead.nextActionAt && lead.nextActionAt < now).length,
        pipelineValue: serializeMoney(pipelineValue), signedThisMonth: signedThisMonth.size },
      operations: { activeProjects: active.length, projectsByService: breakdown,
        completedThisMonth: projects.filter((project) => project.completedAt && project.completedAt >= start && project.completedAt < end).length,
        awaitingPayment: active.filter((project) => project.agreedAmount && Number(projectMoney(project).outstanding) > 0).length,
        awaitingContractor: active.filter((project) => project.contractors.length === 0).length,
        overdue: active.filter((project) => project.expectedCompletionDate && project.expectedCompletionDate < now).length },
      finance: { contractedValue: serializeMoney(contractedValue), revenueCollected: serializeMoney(revenueCollected),
        outstanding: serializeMoney(outstanding), depositsReceived: serializeMoney(depositsReceived), revenueByService: byService },
      marketing,
      stays: { active: stays.filter((stay) => stay.checkIn <= now && stay.checkOut > now && stay.status !== 'CANCELLED').length,
        upcomingCheckIns: stays.filter((stay) => stay.checkIn >= now && stay.checkIn < end && stay.status !== 'CANCELLED').length },
    };
  });
}

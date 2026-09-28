import { Prisma, ProjectPaymentStatus, ProjectPaymentType } from '@prisma/client';

export interface MoneyPayment {
  amount: Prisma.Decimal;
  currency: string;
  type: ProjectPaymentType;
  status: ProjectPaymentStatus;
  paidAt: Date | null;
}

export function netPayments(payments: readonly MoneyPayment[], currency: string): Prisma.Decimal {
  return payments.reduce((sum, payment) => {
    if (payment.status !== 'PAID' || payment.currency !== currency) return sum;
    return payment.type === 'REFUND' ? sum.minus(payment.amount) : sum.plus(payment.amount);
  }, new Prisma.Decimal(0));
}

export function projectMoney(project: {
  quotedAmount: Prisma.Decimal | null;
  agreedAmount: Prisma.Decimal | null;
  currency: string;
  payments: readonly MoneyPayment[];
}) {
  const paid = netPayments(project.payments, project.currency);
  return {
    quoted: project.quotedAmount?.toFixed(2) ?? null,
    agreed: project.agreedAmount?.toFixed(2) ?? null,
    currency: project.currency,
    paid: paid.toFixed(2),
    outstanding: project.agreedAmount ? Prisma.Decimal.max(project.agreedAmount.minus(paid), 0).toFixed(2) : null,
  };
}

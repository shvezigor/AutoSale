import { MetricRegistry } from '@autosale/observability';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { PaymentsService } from './payments.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const accountId = '44444444-4444-4444-8444-444444444444';
const paymentId = '55555555-5555-4555-8555-555555555555';
const now = new Date('2026-09-21T10:00:00.000Z');

const terms = { pricingStatus: 'READY', totalAmount: { toFixed: () => '500.00' }, currency: 'UAH', legalEntityId: 'entity-1' };
const order = { id: orderId, tenantId, commercialTerms: terms };
type PaymentFixture = {
  id: string; orderId: string; amount: { toFixed(): string }; currency: string; method: 'CASH'; receivedAt: Date;
  bankAccount: null; carrier: null; note: null; createdAt: Date; creator: { id: string; name: string };
  cancelledAt: Date | null; canceller: { id: string; name: string } | null; cancellationReason: string | null;
  requestHash: string; idempotencyKey: string; cancellationIdempotencyKey: string | null; cancellationRequestHash: string | null;
};
const payment: PaymentFixture = {
  id: paymentId, orderId, amount: { toFixed: () => '200.00' }, currency: 'UAH', method: 'CASH',
  receivedAt: now, bankAccount: null, carrier: null, note: null, createdAt: now,
  creator: { id: actorId, name: 'Fictional Manager' }, cancelledAt: null, canceller: null, cancellationReason: null,
  requestHash: 'hash', idempotencyKey: '66666666-6666-4666-8666-666666666666', cancellationIdempotencyKey: null, cancellationRequestHash: null,
};

describe('PaymentsService', () => {
  it('records a payment and returns a calculated partial balance', async () => {
    const create = vi.fn().mockResolvedValue(payment);
    const auditCreate = vi.fn().mockResolvedValue({});
    const prisma = prismaMock({ create, auditCreate, payments: [payment] });
    const metrics = new MetricRegistry();
    const service = new PaymentsService(prisma as never, () => now, metrics);

    await expect(service.record(tenantId, orderId, actorId, {
      amount: '200.00', method: 'CASH', receivedAt: now.toISOString(), bankAccountId: null, carrier: null,
      note: null, idempotencyKey: payment.idempotencyKey,
    })).resolves.toMatchObject({ status: 'PARTIALLY_PAID', paidAmount: '200.00', remainingAmount: '300.00' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId, orderId, currency: 'UAH', createdBy: actorId }) }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'ORDER_PAYMENT_RECORDED' }) }));
    expect(metrics.render()).toContain('operation="order_payment_record",result="success"');
  });

  it('rejects missing orders, incomplete pricing, and future dates', async () => {
    await expect(new PaymentsService(prismaMock({ order: null }) as never, () => now).get(tenantId, orderId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(new PaymentsService(prismaMock({ order: { ...order, commercialTerms: { ...terms, pricingStatus: 'NEEDS_REVIEW' } } }) as never, () => now).get(tenantId, orderId)).rejects.toBeInstanceOf(BadRequestException);
    const service = new PaymentsService(prismaMock({}) as never, () => now);
    await expect(service.record(tenantId, orderId, actorId, {
      amount: '10.00', method: 'CASH', receivedAt: '2026-09-21T10:06:00.000Z', bankAccountId: null, carrier: null,
      note: null, idempotencyKey: '77777777-7777-4777-8777-777777777777',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a bank account outside the commercial entity and currency', async () => {
    const prisma = prismaMock({ account: null });
    const service = new PaymentsService(prisma as never, () => now);
    await expect(service.record(tenantId, orderId, actorId, {
      amount: '10.00', method: 'BANK_TRANSFER', receivedAt: now.toISOString(), bankAccountId: accountId, carrier: null,
      note: null, idempotencyKey: '88888888-8888-4888-8888-888888888888',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects reuse of a create key with another payload', async () => {
    const prisma = prismaMock({ existing: { ...payment, requestHash: 'different' } });
    const service = new PaymentsService(prisma as never, () => now);
    await expect(service.record(tenantId, orderId, actorId, {
      amount: '200.00', method: 'CASH', receivedAt: now.toISOString(), bankAccountId: null, carrier: null,
      note: null, idempotencyKey: payment.idempotencyKey,
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('cancels without changing the original financial fields', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn().mockResolvedValue({});
    const prisma = prismaMock({ existingPayment: payment, updateMany, auditCreate, payments: [{ ...payment, cancelledAt: now, cancellationReason: 'Correction', canceller: { id: actorId, name: 'Fictional Owner' } }] });
    const service = new PaymentsService(prisma as never, () => now);
    await service.cancel(tenantId, orderId, paymentId, actorId, { reason: 'Correction', idempotencyKey: '99999999-9999-4999-8999-999999999999' });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: paymentId, tenantId, orderId, cancelledAt: null },
      data: expect.not.objectContaining({ amount: expect.anything(), currency: expect.anything() }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'ORDER_PAYMENT_CANCELLED' }) }));
  });
});

function prismaMock(options: {
  order?: typeof order | null;
  create?: ReturnType<typeof vi.fn>;
  auditCreate?: ReturnType<typeof vi.fn>;
  existing?: typeof payment | null;
  existingPayment?: typeof payment | null;
  account?: object | null;
  payments?: typeof payment[];
  updateMany?: ReturnType<typeof vi.fn>;
} = {}) {
  const client = {
    order: { findFirst: vi.fn().mockResolvedValue(options.order === undefined ? order : options.order) },
    tenantBankAccount: { findFirst: vi.fn().mockResolvedValue(options.account === undefined ? { id: accountId } : options.account) },
    orderPayment: {
      findUnique: vi.fn().mockResolvedValue(options.existing ?? null),
      findFirst: vi.fn().mockResolvedValue(options.existingPayment ?? null),
      findMany: vi.fn().mockResolvedValue(options.payments ?? []),
      create: options.create ?? vi.fn().mockResolvedValue(payment),
      updateMany: options.updateMany ?? vi.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: { create: options.auditCreate ?? vi.fn().mockResolvedValue({}) },
  };
  return { ...client, $transaction: vi.fn((operation: (tx: typeof client) => unknown) => operation(client)) };
}

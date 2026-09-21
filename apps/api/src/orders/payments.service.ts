import { createHash } from 'node:crypto';

import type { CancelOrderPayment, CashOnDeliveryCarrier, CreateOrderPayment, OrderPaymentRecord, OrderPaymentSummary, PaymentMethod } from '@autosale/contracts/payments';
import { calculateOrderPaymentSummary, Prisma, type PrismaClient } from '@autosale/database';
import { metrics, type MetricRegistry } from '@autosale/observability';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const MAX_SERIALIZABLE_ATTEMPTS = 3;

export class PaymentsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
    private readonly registry: MetricRegistry = metrics,
  ) {}

  async get(tenantId: string, orderId: string): Promise<OrderPaymentSummary> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { commercialTerms: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    const terms = order.commercialTerms;
    if (!terms || terms.pricingStatus !== 'READY' || !terms.totalAmount || !terms.currency) {
      throw new BadRequestException('Order payment amount is not ready');
    }
    const payments = await this.prisma.orderPayment.findMany({
      where: { tenantId, orderId },
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        creator: { select: { id: true, name: true } },
        canceller: { select: { id: true, name: true } },
        bankAccount: { select: { id: true, label: true } },
      },
    });
    const amounts = calculateOrderPaymentSummary(
      terms.totalAmount.toFixed(2),
      payments.map((payment) => ({ amount: payment.amount.toFixed(2), cancelledAt: payment.cancelledAt })),
    );
    return { ...amounts, currency: terms.currency, payments: payments.map(mapPayment) };
  }

  async record(tenantId: string, orderId: string, actorUserId: string, input: CreateOrderPayment): Promise<OrderPaymentSummary> {
    return this.measure('order_payment_record', async () => {
      const receivedAt = new Date(input.receivedAt);
      if (receivedAt.getTime() > this.now().getTime() + MAX_FUTURE_SKEW_MS) throw new BadRequestException('Payment date is in the future');
      const requestHash = commandHash(createCommandPayload(orderId, input));
      try {
        await this.serializable(async () => this.prisma.$transaction(async (tx) => {
          const order = await readyOrder(tx, tenantId, orderId);
          if (input.method === 'BANK_TRANSFER') {
            const legalEntityId = order.commercialTerms!.legalEntityId;
            if (!legalEntityId) throw new BadRequestException('Bank account does not match legal entity and currency');
            const account = await tx.tenantBankAccount.findFirst({ where: {
              id: input.bankAccountId, tenantId, legalEntityId,
              currency: order.commercialTerms!.currency!, active: true,
            } });
            if (!account) throw new BadRequestException('Bank account does not match legal entity and currency');
          }
          const existing = await tx.orderPayment.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } } });
          if (existing) {
            assertCreateReplay(existing, orderId, requestHash);
            return;
          }
          const payment = await tx.orderPayment.create({ data: {
            tenantId, orderId, amount: input.amount, currency: order.commercialTerms!.currency!, method: input.method,
            receivedAt, bankAccountId: input.bankAccountId, carrier: input.carrier, note: input.note,
            createdBy: actorUserId, idempotencyKey: input.idempotencyKey, requestHash,
          } });
          await tx.auditLog.create({ data: {
            tenantId, orderId, actor: actorUserId, action: 'ORDER_PAYMENT_RECORDED',
            changes: {
              paymentId: payment.id, amount: input.amount, currency: order.commercialTerms!.currency!, method: input.method,
              ...(input.bankAccountId ? { bankAccountId: input.bankAccountId } : {}), ...(input.carrier ? { carrier: input.carrier } : {}),
            },
          } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
      } catch (error) {
        if (!isPrismaCode(error, 'P2002')) throw error;
        const existing = await this.prisma.orderPayment.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } } });
        if (!existing) throw error;
        assertCreateReplay(existing, orderId, requestHash);
      }
      return this.get(tenantId, orderId);
    });
  }

  async cancel(tenantId: string, orderId: string, paymentId: string, actorUserId: string, input: CancelOrderPayment): Promise<OrderPaymentSummary> {
    return this.measure('order_payment_cancel', async () => {
      const requestHash = commandHash({ orderId, paymentId, reason: input.reason });
      await this.serializable(async () => this.prisma.$transaction(async (tx) => {
        const payment = await tx.orderPayment.findFirst({ where: { id: paymentId, tenantId, orderId } });
        if (!payment) throw new NotFoundException('Payment not found');
        if (payment.cancelledAt) {
          if (payment.cancellationIdempotencyKey === input.idempotencyKey && payment.cancellationRequestHash === requestHash) return;
          throw new ConflictException('Payment is already cancelled');
        }
        const result = await tx.orderPayment.updateMany({
          where: { id: paymentId, tenantId, orderId, cancelledAt: null },
          data: {
            cancelledAt: this.now(), cancelledBy: actorUserId, cancellationReason: input.reason,
            cancellationIdempotencyKey: input.idempotencyKey, cancellationRequestHash: requestHash,
          },
        });
        if (result.count !== 1) throw new ConflictException('Payment changed; reload and try again');
        await tx.auditLog.create({ data: {
          tenantId, orderId, actor: actorUserId, action: 'ORDER_PAYMENT_CANCELLED', changes: { paymentId },
        } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
      return this.get(tenantId, orderId);
    });
  }

  private async serializable<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try { return await operation(); }
      catch (error) {
        if (!isPrismaCode(error, 'P2034') || attempt >= MAX_SERIALIZABLE_ATTEMPTS) throw error;
      }
    }
  }

  private async measure<T>(operation: 'order_payment_record' | 'order_payment_cancel', action: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      const result = await action();
      this.registry.increment('autosale_operations_total', { operation, result: 'success' });
      return result;
    } catch (error) {
      const result = error instanceof ConflictException ? 'conflict' : 'failure';
      this.registry.increment('autosale_operations_total', { operation, result });
      throw error;
    } finally {
      this.registry.observe('autosale_operation_duration_seconds', (performance.now() - started) / 1_000, { operation });
    }
  }
}

async function readyOrder(tx: Prisma.TransactionClient, tenantId: string, orderId: string) {
  const order = await tx.order.findFirst({ where: { id: orderId, tenantId }, include: { commercialTerms: true } });
  if (!order) throw new NotFoundException('Order not found');
  if (!order.commercialTerms || order.commercialTerms.pricingStatus !== 'READY' || !order.commercialTerms.totalAmount || !order.commercialTerms.currency) {
    throw new BadRequestException('Order payment amount is not ready');
  }
  return order;
}

function createCommandPayload(orderId: string, input: CreateOrderPayment) {
  return {
    orderId, amount: input.amount, method: input.method, receivedAt: input.receivedAt,
    bankAccountId: input.bankAccountId, carrier: input.carrier, note: input.note,
  };
}

function commandHash(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assertCreateReplay(existing: { orderId: string; requestHash: string }, orderId: string, requestHash: string): void {
  if (existing.orderId !== orderId || existing.requestHash !== requestHash) throw new ConflictException('Idempotency key was already used');
}

function isPrismaCode(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function mapPayment(payment: {
  id: string; amount: { toFixed(digits: number): string }; currency: string; method: PaymentMethod; receivedAt: Date;
  bankAccount: { id: string; label: string } | null; carrier: string | null; note: string | null;
  creator: { id: string; name: string }; createdAt: Date; cancelledAt: Date | null;
  canceller: { id: string; name: string } | null; cancellationReason: string | null;
}): OrderPaymentRecord {
  return {
    id: payment.id, amount: payment.amount.toFixed(2), currency: payment.currency, method: payment.method,
    receivedAt: payment.receivedAt.toISOString(), bankAccount: payment.bankAccount,
    carrier: payment.carrier as CashOnDeliveryCarrier | null, note: payment.note, createdBy: payment.creator,
    createdAt: payment.createdAt.toISOString(), cancelledAt: payment.cancelledAt?.toISOString() ?? null,
    cancelledBy: payment.canceller, cancellationReason: payment.cancellationReason,
  };
}

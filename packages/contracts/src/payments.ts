import { z } from 'zod';

import { moneyStringSchema } from './commercial.js';

export const paymentMethodSchema = z.enum(['BANK_TRANSFER', 'CASH', 'CASH_ON_DELIVERY', 'OTHER']);
export const orderPaymentStatusSchema = z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERPAID']);
export const cashOnDeliveryCarrierSchema = z.enum(['NOVA_POSHTA', 'MEEST', 'UKRPOSHTA']);

const commandBase = z.object({
  amount: moneyStringSchema.refine((value) => BigInt(value.replace('.', '')) > 0n, 'Amount must be positive'),
  receivedAt: z.string().datetime({ offset: true }),
  note: z.string().trim().max(500).nullable().optional().default(null),
  idempotencyKey: z.string().uuid(),
});

export const createOrderPaymentSchema = z.discriminatedUnion('method', [
  commandBase.extend({ method: z.literal('BANK_TRANSFER'), bankAccountId: z.string().uuid(), carrier: z.null().optional().default(null) }).strict(),
  commandBase.extend({ method: z.literal('CASH'), bankAccountId: z.null().optional().default(null), carrier: z.null().optional().default(null) }).strict(),
  commandBase.extend({ method: z.literal('CASH_ON_DELIVERY'), bankAccountId: z.null().optional().default(null), carrier: cashOnDeliveryCarrierSchema }).strict(),
  commandBase.extend({ method: z.literal('OTHER'), bankAccountId: z.null().optional().default(null), carrier: z.null().optional().default(null) }).strict(),
]);

export const cancelOrderPaymentSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().uuid(),
}).strict();

export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export type OrderPaymentStatus = z.infer<typeof orderPaymentStatusSchema>;
export type CashOnDeliveryCarrier = z.infer<typeof cashOnDeliveryCarrierSchema>;
export type CreateOrderPayment = z.infer<typeof createOrderPaymentSchema>;
export type CancelOrderPayment = z.infer<typeof cancelOrderPaymentSchema>;

export interface PaymentActorSummary {
  id: string;
  name: string;
}

export interface OrderPaymentRecord {
  id: string;
  amount: string;
  currency: string;
  method: PaymentMethod;
  receivedAt: string;
  bankAccount: { id: string; label: string } | null;
  carrier: CashOnDeliveryCarrier | null;
  note: string | null;
  createdBy: PaymentActorSummary;
  createdAt: string;
  cancelledAt: string | null;
  cancelledBy: PaymentActorSummary | null;
  cancellationReason: string | null;
}

export interface OrderPaymentSummary {
  expectedAmount: string;
  paidAmount: string;
  remainingAmount: string;
  currency: string;
  status: OrderPaymentStatus;
  payments: OrderPaymentRecord[];
}

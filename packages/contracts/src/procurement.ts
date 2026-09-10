import { z } from 'zod';

export const procurementStatusSchema = z.enum([
  'UNASSESSED',
  'IN_STOCK',
  'TO_ORDER',
  'SENDING',
  'ORDERED',
  'SUPPLIER_CONFIRMED',
  'RECEIVED',
  'UNAVAILABLE',
]);

export const procurementSummarySchema = z.enum([
  'UNASSESSED',
  'READY',
  'PARTIALLY_READY',
  'NEEDS_ORDER',
  'SENDING',
  'AWAITING_SUPPLIER',
  'BLOCKED',
  'HANDED_OFF',
]);

export const procurementDecisionSourceSchema = z.enum(['AUTO', 'MANUAL']);
export const inventoryReservationStatusSchema = z.enum(['ACTIVE', 'CONSUMED', 'RELEASED']);

export const procurementTransitionSchema = z.object({
  status: z.enum(['IN_STOCK', 'TO_ORDER', 'SUPPLIER_CONFIRMED', 'RECEIVED', 'UNAVAILABLE']),
}).strict();

export const procurementReasonSchema = z.enum([
  'STOCK_AVAILABLE',
  'STOCK_INSUFFICIENT',
  'STOCK_UNKNOWN',
  'PRODUCT_UNMATCHED',
  'RESERVATION_CONFLICT',
  'MANUAL_IN_STOCK',
  'MANUAL_TO_ORDER',
  'DELIVERY_FAILED',
]);

export const telegramAlertEventTypeSchema = z.enum([
  'ORDER_NEEDS_REVIEW',
  'ORDER_AUTO_APPROVED',
  'SUPPLIER_DELIVERY_FAILED',
]);

export const telegramNotificationPreferencesSchema = z.object({
  ORDER_NEEDS_REVIEW: z.boolean(),
  ORDER_AUTO_APPROVED: z.boolean(),
  SUPPLIER_DELIVERY_FAILED: z.boolean(),
}).strict();

export type ProcurementStatus = z.infer<typeof procurementStatusSchema>;
export type ProcurementSummary = z.infer<typeof procurementSummarySchema>;
export type ProcurementDecisionSource = z.infer<typeof procurementDecisionSourceSchema>;
export type InventoryReservationStatus = z.infer<typeof inventoryReservationStatusSchema>;
export type ProcurementReason = z.infer<typeof procurementReasonSchema>;
export type TelegramAlertEventType = z.infer<typeof telegramAlertEventTypeSchema>;
export type TelegramNotificationPreferences = z.infer<typeof telegramNotificationPreferencesSchema>;

export interface InventoryReservationSummary {
  id: string;
  quantity: number;
  status: InventoryReservationStatus;
}

export interface SupplierDispatchSummary {
  deliveryId: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'RETRYABLE' | 'FAILED';
  itemCount: number;
}

export interface SupplierOrderPreview {
  orderId: string;
  companyName: string;
  supplierName: string;
  items: Array<{
    orderItemId: string;
    productName: string;
    sku: string | null;
    quantity: number;
    color: string | null;
    size: string | null;
  }>;
}

export function procurementSummaryFor(
  statuses: ProcurementStatus[],
  handedOff: boolean,
): ProcurementSummary {
  if (handedOff) return 'HANDED_OFF';
  if (statuses.length === 0 || statuses.includes('UNASSESSED')) return 'UNASSESSED';
  if (statuses.includes('UNAVAILABLE')) return 'BLOCKED';
  if (statuses.includes('SENDING')) return 'SENDING';

  const ready = statuses.filter((status) => status === 'IN_STOCK' || status === 'RECEIVED').length;
  const toOrder = statuses.filter((status) => status === 'TO_ORDER').length;
  const awaitingSupplier = statuses.filter(
    (status) => status === 'ORDERED' || status === 'SUPPLIER_CONFIRMED',
  ).length;

  if (ready === statuses.length) return 'READY';
  if (ready > 0) return 'PARTIALLY_READY';
  if (toOrder === statuses.length) return 'NEEDS_ORDER';
  if (awaitingSupplier === statuses.length) return 'AWAITING_SUPPLIER';
  if (awaitingSupplier > 0 && toOrder === 0) return 'AWAITING_SUPPLIER';
  return 'PARTIALLY_READY';
}

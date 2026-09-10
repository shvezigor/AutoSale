import {
  procurementSummaryFor,
  type ProcurementReason,
  type ProcurementStatus,
  type ProcurementSummary,
} from '@autosale/contracts/procurement';

import { Prisma, type PrismaClient } from './generated/prisma/client.js';

export interface ProcurementAssessment {
  orderId: string;
  summary: ProcurementSummary;
  items: Array<{
    id: string;
    status: ProcurementStatus;
    reason: ProcurementReason;
    stockAtDecision: number | null;
    availableAtDecision: number | null;
    reservedQuantity: number;
  }>;
}

export class ProcurementOrderNotApprovedError extends Error {
  constructor() {
    super('Only approved orders can be assessed for procurement');
    this.name = 'ProcurementOrderNotApprovedError';
  }
}

export class ProcurementItemNotFoundError extends Error {
  constructor() {
    super('Procurement item not found');
    this.name = 'ProcurementItemNotFoundError';
  }
}

export class InvalidProcurementTransitionError extends Error {
  constructor(from: ProcurementStatus, to: ProcurementStatus) {
    super(`Invalid procurement transition from ${from} to ${to}`);
    this.name = 'InvalidProcurementTransitionError';
  }
}

export class ProcurementOrderNotReadyError extends Error {
  constructor() {
    super('Order procurement is not ready for hand-off');
    this.name = 'ProcurementOrderNotReadyError';
  }
}

type LockedProduct = {
  id: string;
  sku: string;
  stockQuantity: number | null;
};

export class ProcurementStore {
  constructor(private readonly prisma: PrismaClient) {}

  assessApprovedOrder(
    tenantId: string,
    orderId: string,
    actor: string,
  ): Promise<ProcurementAssessment> {
    return this.prisma.$transaction(async (transaction) => {
      const order = await transaction.order.findFirst({
        where: { id: orderId, tenantId },
        include: { items: { orderBy: { id: 'asc' } } },
      });
      if (!order || !['APPROVED', 'AUTO_APPROVED'].includes(order.status)) {
        throw new ProcurementOrderNotApprovedError();
      }

      const skus = [...new Set(order.items.flatMap((item) => item.catalogId ? [item.catalogId] : []))].sort();
      const products = skus.length === 0
        ? []
        : await transaction.$queryRaw<LockedProduct[]>(Prisma.sql`
          SELECT "id", "sku", "stock_quantity" AS "stockQuantity"
          FROM "products"
          WHERE "tenant_id" = ${tenantId}::uuid
            AND "sku" IN (${Prisma.join(skus)})
            AND "active" = TRUE
          ORDER BY "id"
          FOR UPDATE
        `);
      const productsBySku = new Map(products.map((product) => [product.sku, product]));

      const itemIds = order.items.map((item) => item.id);
      if (itemIds.length > 0) {
        await transaction.inventoryReservation.updateMany({
          where: { tenantId, orderItemId: { in: itemIds }, status: 'ACTIVE' },
          data: { status: 'RELEASED', releasedAt: new Date(), consumedAt: null },
        });
      }

      const reservationTotals = products.length === 0
        ? []
        : await transaction.inventoryReservation.groupBy({
          by: ['productId'],
          where: { tenantId, productId: { in: products.map((product) => product.id) }, status: 'ACTIVE' },
          _sum: { quantity: true },
        });
      const reservedByProduct = new Map(
        reservationTotals.map((row) => [row.productId, row._sum.quantity ?? 0]),
      );
      const now = new Date();
      const assessedItems: ProcurementAssessment['items'] = [];

      for (const item of order.items) {
        const product = item.catalogId ? productsBySku.get(item.catalogId) : undefined;
        let status: ProcurementStatus = 'TO_ORDER';
        let reason: ProcurementReason = 'PRODUCT_UNMATCHED';
        let stockAtDecision: number | null = null;
        let availableAtDecision: number | null = null;
        let reservedQuantity = 0;

        if (product) {
          stockAtDecision = product.stockQuantity;
          if (product.stockQuantity === null) {
            reason = 'STOCK_UNKNOWN';
          } else {
            const alreadyReserved = reservedByProduct.get(product.id) ?? 0;
            availableAtDecision = Math.max(0, product.stockQuantity - alreadyReserved);
            if (availableAtDecision >= item.quantity) {
              status = 'IN_STOCK';
              reason = 'STOCK_AVAILABLE';
              reservedQuantity = item.quantity;
              reservedByProduct.set(product.id, alreadyReserved + item.quantity);
              await transaction.inventoryReservation.upsert({
                where: { tenantId_orderItemId: { tenantId, orderItemId: item.id } },
                create: {
                  tenantId,
                  productId: product.id,
                  orderItemId: item.id,
                  quantity: item.quantity,
                  status: 'ACTIVE',
                },
                update: {
                  productId: product.id,
                  quantity: item.quantity,
                  status: 'ACTIVE',
                  releasedAt: null,
                  consumedAt: null,
                },
              });
            } else {
              reason = product.stockQuantity >= item.quantity
                ? 'RESERVATION_CONFLICT'
                : 'STOCK_INSUFFICIENT';
            }
          }
        }

        await transaction.orderItem.update({
          where: { id: item.id },
          data: {
            procurementStatus: status,
            procurementSource: 'AUTO',
            procurementReason: reason,
            stockAtDecision,
            availableAtDecision,
            procurementUpdatedAt: now,
          },
        });
        assessedItems.push({
          id: item.id,
          status,
          reason,
          stockAtDecision,
          availableAtDecision,
          reservedQuantity,
        });
      }

      const summary = procurementSummaryFor(assessedItems.map((item) => item.status), false);
      await transaction.auditLog.create({
        data: {
          tenantId,
          orderId,
          actor,
          action: 'PROCUREMENT_ASSESSED',
          changes: {
            summary,
            items: assessedItems.map((item) => ({
              id: item.id,
              status: item.status,
              reason: item.reason,
              reservedQuantity: item.reservedQuantity,
            })),
          },
        },
      });

      return { orderId, summary, items: assessedItems };
    });
  }

  async releaseOrderReservations(tenantId: string, orderId: string, actor: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const order = await transaction.order.findFirst({
        where: { id: orderId, tenantId },
        select: { id: true, items: { select: { id: true } } },
      });
      if (!order) return;
      const released = await transaction.inventoryReservation.updateMany({
        where: {
          tenantId,
          orderItemId: { in: order.items.map((item) => item.id) },
          status: 'ACTIVE',
        },
        data: { status: 'RELEASED', releasedAt: new Date() },
      });
      if (released.count > 0) {
        await transaction.auditLog.create({
          data: {
            tenantId,
            orderId,
            actor,
            action: 'PROCUREMENT_RESERVATIONS_RELEASED',
            changes: { releasedCount: released.count },
          },
        });
      }
    });
  }

  setItemStatus(
    tenantId: string,
    orderId: string,
    itemId: string,
    nextStatus: ProcurementStatus,
    actor: string,
  ): Promise<{ orderId: string; summary: ProcurementSummary }> {
    return this.prisma.$transaction(async (transaction) => {
      const item = await transaction.orderItem.findFirst({
        where: { id: itemId, orderId, tenantId },
        include: { reservation: true },
      });
      if (!item) throw new ProcurementItemNotFoundError();
      const currentStatus = item.procurementStatus;
      if (currentStatus !== nextStatus && !allowedTransitions[currentStatus].includes(nextStatus)) {
        throw new InvalidProcurementTransitionError(currentStatus, nextStatus);
      }

      let reason = item.procurementReason;
      let stockAtDecision = item.stockAtDecision;
      let availableAtDecision = item.availableAtDecision;
      if (nextStatus === 'IN_STOCK') {
        const product = item.catalogId
          ? (await transaction.$queryRaw<LockedProduct[]>(Prisma.sql`
              SELECT "id", "sku", "stock_quantity" AS "stockQuantity"
              FROM "products"
              WHERE "tenant_id" = ${tenantId}::uuid AND "sku" = ${item.catalogId} AND "active" = TRUE
              FOR UPDATE
            `))[0]
          : undefined;
        if (!product || product.stockQuantity === null) {
          throw new ProcurementOrderNotReadyError();
        }
        const aggregate = await transaction.inventoryReservation.aggregate({
          where: {
            tenantId,
            productId: product.id,
            status: 'ACTIVE',
            orderItemId: { not: item.id },
          },
          _sum: { quantity: true },
        });
        const alreadyReserved = aggregate._sum.quantity ?? 0;
        const available = Math.max(0, product.stockQuantity - alreadyReserved);
        if (available < item.quantity) throw new ProcurementOrderNotReadyError();
        await transaction.inventoryReservation.upsert({
          where: { tenantId_orderItemId: { tenantId, orderItemId: item.id } },
          create: {
            tenantId,
            productId: product.id,
            orderItemId: item.id,
            quantity: item.quantity,
            status: 'ACTIVE',
          },
          update: {
            productId: product.id,
            quantity: item.quantity,
            status: 'ACTIVE',
            releasedAt: null,
            consumedAt: null,
          },
        });
        reason = 'MANUAL_IN_STOCK';
        stockAtDecision = product.stockQuantity;
        availableAtDecision = available;
      } else if (nextStatus === 'TO_ORDER' || nextStatus === 'UNAVAILABLE') {
        await transaction.inventoryReservation.updateMany({
          where: { tenantId, orderItemId: item.id, status: 'ACTIVE' },
          data: { status: 'RELEASED', releasedAt: new Date() },
        });
        reason = nextStatus === 'TO_ORDER' ? 'MANUAL_TO_ORDER' : reason;
      }

      await transaction.orderItem.update({
        where: { id: item.id },
        data: {
          procurementStatus: nextStatus,
          procurementSource: 'MANUAL',
          procurementReason: reason,
          stockAtDecision,
          availableAtDecision,
          procurementUpdatedAt: new Date(),
        },
      });
      await transaction.auditLog.create({
        data: {
          tenantId,
          orderId,
          actor,
          action: 'PROCUREMENT_STATUS_CHANGED',
          changes: { itemId, from: currentStatus, to: nextStatus },
        },
      });
      const orderState = await transaction.order.findUniqueOrThrow({
        where: { tenantId_id: { tenantId, id: orderId } },
        select: {
          procurementHandedOffAt: true,
          items: { select: { procurementStatus: true } },
        },
      });
      return {
        orderId,
        summary: procurementSummaryFor(
          orderState.items.map((row) => row.procurementStatus),
          Boolean(orderState.procurementHandedOffAt),
        ),
      };
    });
  }

  handOffOrder(
    tenantId: string,
    orderId: string,
    actor: string,
  ): Promise<{ orderId: string; summary: ProcurementSummary; handedOffAt: string }> {
    return this.prisma.$transaction(async (transaction) => {
      const order = await transaction.order.findFirst({
        where: { id: orderId, tenantId },
        include: { items: { include: { reservation: true }, orderBy: { id: 'asc' } } },
      });
      if (!order) throw new ProcurementItemNotFoundError();
      if (order.procurementHandedOffAt) {
        return { orderId, summary: 'HANDED_OFF', handedOffAt: order.procurementHandedOffAt.toISOString() };
      }
      const summary = procurementSummaryFor(order.items.map((item) => item.procurementStatus), false);
      if (summary !== 'READY') throw new ProcurementOrderNotReadyError();

      const activeReservations = order.items.flatMap((item) =>
        item.reservation?.status === 'ACTIVE' ? [item.reservation] : [],
      );
      const productIds = [...new Set(activeReservations.map((reservation) => reservation.productId))].sort();
      if (productIds.length > 0) {
        await transaction.$queryRaw(Prisma.sql`
          SELECT "id" FROM "products"
          WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ANY(ARRAY[${Prisma.join(productIds)}]::uuid[])
          ORDER BY "id" FOR UPDATE
        `);
      }
      const quantityByProduct = new Map<string, number>();
      for (const reservation of activeReservations) {
        quantityByProduct.set(
          reservation.productId,
          (quantityByProduct.get(reservation.productId) ?? 0) + reservation.quantity,
        );
      }
      for (const [productId, quantity] of quantityByProduct) {
        await transaction.product.update({
          where: { tenantId_id: { tenantId, id: productId } },
          data: { stockQuantity: { decrement: quantity } },
        });
      }
      const handedOffAt = new Date();
      if (activeReservations.length > 0) {
        await transaction.inventoryReservation.updateMany({
          where: { tenantId, id: { in: activeReservations.map((reservation) => reservation.id) }, status: 'ACTIVE' },
          data: { status: 'CONSUMED', consumedAt: handedOffAt },
        });
      }
      await transaction.order.update({
        where: { tenantId_id: { tenantId, id: orderId } },
        data: { procurementHandedOffAt: handedOffAt, procurementHandedOffBy: actor },
      });
      await transaction.auditLog.create({
        data: {
          tenantId,
          orderId,
          actor,
          action: 'ORDER_HANDED_OFF',
          changes: { consumedReservationCount: activeReservations.length },
        },
      });
      return { orderId, summary: 'HANDED_OFF', handedOffAt: handedOffAt.toISOString() };
    });
  }
}

const allowedTransitions: Record<ProcurementStatus, readonly ProcurementStatus[]> = {
  UNASSESSED: ['IN_STOCK', 'TO_ORDER', 'UNAVAILABLE'],
  IN_STOCK: ['TO_ORDER', 'UNAVAILABLE'],
  TO_ORDER: ['IN_STOCK', 'UNAVAILABLE'],
  SENDING: [],
  ORDERED: ['SUPPLIER_CONFIRMED', 'UNAVAILABLE'],
  SUPPLIER_CONFIRMED: ['RECEIVED', 'UNAVAILABLE'],
  RECEIVED: [],
  UNAVAILABLE: ['TO_ORDER', 'IN_STOCK'],
};

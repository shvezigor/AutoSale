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
}

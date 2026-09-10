import type { ManagerOrder, ManagerOrderUpdate, OrderListResponse, OrderStatus } from '@autosale/contracts/orders';
import { procurementSummaryFor } from '@autosale/contracts/procurement';
import type { ProcurementStatus } from '@autosale/contracts/procurement';
import {
  InvalidProcurementTransitionError,
  ProcurementItemNotFoundError,
  ProcurementOrderNotReadyError,
  ProcurementStore,
  Prisma,
  type PrismaClient,
} from '@autosale/database';
import { BadRequestException, NotFoundException } from '@nestjs/common';

type Extraction = {
  isOrder?: boolean;
  customer?: ManagerOrder['customer'];
  delivery?: ManagerOrder['delivery'];
  items?: Array<{ quantity?: number; confidence?: number }>;
};

export type OrderListQuery = {
  search?: string | undefined;
  status?: OrderStatus | undefined;
  page: number;
  pageSize: number;
};

export class OrdersService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly procurement = new ProcurementStore(prisma),
  ) {}

  async list(tenantId: string, query: OrderListQuery): Promise<OrderListResponse> {
    const search = query.search?.trim();
    const where: Prisma.OrderWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(search ? {
        OR: [
          { conversation: { is: { displayName: { contains: search, mode: 'insensitive' } } } },
          { conversation: { is: { profile: { is: { displayName: { contains: search, mode: 'insensitive' } } } } } },
          { conversation: { is: { profile: { is: { username: { contains: search, mode: 'insensitive' } } } } } },
          { items: { some: { originalText: { contains: search, mode: 'insensitive' } } } },
          { items: { some: { catalogId: { contains: search, mode: 'insensitive' } } } },
        ],
      } : {}),
    };
    const [rows, total, products] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: this.include,
      }),
      this.prisma.order.count({ where }),
      this.productNames(tenantId),
    ]);
    return { items: rows.map((row) => this.map(row, products)), page: query.page, pageSize: query.pageSize, total };
  }

  async detail(tenantId: string, id: string): Promise<ManagerOrder> {
    const row = await this.find(tenantId, id);
    return this.map(row, await this.productNames(tenantId));
  }

  async approve(tenantId: string, id: string, actor: string): Promise<ManagerOrder> {
    await this.transition(tenantId, id, actor, 'APPROVED', 'ORDER_APPROVED');
    await this.procurement.assessApprovedOrder(tenantId, id, actor);
    await this.ensurePendingExport(tenantId, id);
    return this.detail(tenantId, id);
  }

  private async ensurePendingExport(tenantId: string, orderId: string): Promise<void> {
    const destination = await this.prisma.googleSheetsDestination.findUnique({ where: { tenantId } });
    if (!destination || destination.status !== 'ACTIVE') return;
    await this.prisma.orderExport.upsert({
      where: { orderId_destinationId: { orderId, destinationId: destination.id } },
      create: { tenantId, orderId, destinationId: destination.id },
      update: { status: 'PENDING', errorSummary: null },
    });
  }

  async cancel(tenantId: string, id: string, actor: string): Promise<ManagerOrder> {
    await this.transition(tenantId, id, actor, 'CANCELLED', 'ORDER_CANCELLED');
    await this.procurement.releaseOrderReservations(tenantId, id, actor);
    return this.detail(tenantId, id);
  }

  async retrySheetsExport(tenantId: string, id: string): Promise<NonNullable<ManagerOrder['sheetsExport']>> {
    await this.find(tenantId, id);
    const record = await this.prisma.orderExport.findFirst({ where: { orderId: id, tenantId }, include: { destination: { select: { status: true } } } });
    if (!record) throw new NotFoundException('Google Sheets export not found');
    if (record.destination.status !== 'ACTIVE') throw new BadRequestException('Google Sheets destination must be active before retry');
    if (record.status !== 'FAILED') throw new BadRequestException('Only failed exports can be retried');
    const updated = await this.prisma.orderExport.update({ where: { id: record.id }, data: { status: 'PENDING', errorSummary: null } });
    return this.mapExport(updated, true);
  }

  async setItemProcurement(
    tenantId: string,
    orderId: string,
    itemId: string,
    status: ProcurementStatus,
    actor: string,
  ): Promise<ManagerOrder> {
    try {
      await this.procurement.setItemStatus(tenantId, orderId, itemId, status, actor);
    } catch (error) {
      this.mapProcurementError(error);
    }
    return this.detail(tenantId, orderId);
  }

  async handOff(tenantId: string, orderId: string, actor: string): Promise<ManagerOrder> {
    try {
      await this.procurement.handOffOrder(tenantId, orderId, actor);
    } catch (error) {
      this.mapProcurementError(error);
    }
    return this.detail(tenantId, orderId);
  }

  async update(tenantId: string, id: string, actor: string, input: ManagerOrderUpdate): Promise<ManagerOrder> {
    const current = await this.find(tenantId, id);
    const products = await this.productNames(tenantId);
    for (const item of input.items ?? []) {
      if (item.catalogId !== null && !products.has(item.catalogId)) throw new BadRequestException('Unknown catalogue SKU');
      if (!current.items.some((existing) => existing.id === item.id)) throw new BadRequestException('Unknown order item');
    }
    const extraction = (current.extraction ?? {}) as Extraction;
    const nextExtraction = {
      ...extraction,
      customer: { name: null, phone: null, instagramUsername: null, ...extraction.customer, ...input.customer },
      delivery: { city: null, address: null, novaPoshtaBranch: null, ...extraction.delivery, ...input.delivery },
    };
    const updated = await this.prisma.$transaction(async (tx) => {
      for (const item of input.items ?? []) {
        await tx.orderItem.update({ where: { id: item.id }, data: { catalogId: item.catalogId, quantity: item.quantity, color: item.color, size: item.size } });
      }
      const rows = input.items ?? current.items;
      const issues = validationIssues(nextExtraction, rows);
      const order = await tx.order.update({ where: { id, tenantId }, data: { extraction: nextExtraction as Prisma.InputJsonObject, validationIssues: issues, status: 'NEEDS_REVIEW' }, include: this.include });
      await tx.auditLog.create({ data: { tenantId, orderId: id, actor, action: 'ORDER_CORRECTED', changes: JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue } });
      return order;
    });
    return this.map(updated, products);
  }

  private async transition(tenantId: string, id: string, actor: string, status: OrderStatus, action: string): Promise<ManagerOrder> {
    const current = await this.find(tenantId, id);
    const currentIssues = validationIssues((current.extraction ?? {}) as Extraction, current.items);
    if (status === 'APPROVED' && currentIssues.length > 0) {
      throw new BadRequestException('Order has unresolved validation issues');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.update({
        where: { id, tenantId },
        data: { status, approvedAt: status === 'APPROVED' ? new Date() : null, approvedBy: status === 'APPROVED' ? actor : null },
        include: this.include,
      });
      await tx.auditLog.create({ data: { tenantId, orderId: id, actor, action, changes: { status: { from: current.status, to: status } } } });
      return order;
    });
    return this.map(updated, await this.productNames(tenantId));
  }

  private find(tenantId: string, id: string) {
    return this.prisma.order.findFirst({ where: { id, tenantId }, include: this.include }).then((row) => {
      if (!row) throw new NotFoundException('Order not found');
      return row;
    });
  }

  private readonly include = {
    conversation: {
      select: {
        displayName: true,
        channel: true,
        profile: { select: { displayName: true, username: true } },
      },
    },
    items: { orderBy: { createdAt: 'asc' as const }, include: { reservation: true } },
    exports: { orderBy: { createdAt: 'desc' as const }, take: 1, include: { destination: { select: { status: true } } } },
    telegramDeliveries: {
      where: { purpose: 'SUPPLIER_ORDER' as const },
      orderBy: { createdAt: 'desc' as const },
      take: 1,
      include: { _count: { select: { items: true } } },
    },
  };

  private async productNames(tenantId: string): Promise<Map<string, string>> {
    const products = await this.prisma.product.findMany({ where: { tenantId }, select: { sku: true, name: true } });
    return new Map(products.map((product) => [product.sku, product.name]));
  }

  private map(row: Awaited<ReturnType<OrdersService['find']>>, products: Map<string, string>): ManagerOrder {
    const extraction = (row.extraction ?? {}) as Extraction;
    const customer = {
      name: extraction.customer?.name ?? null,
      phone: extraction.customer?.phone ?? null,
      instagramUsername: extraction.customer?.instagramUsername ?? row.conversation.profile?.username ?? null,
    };
    const procurementStatuses = row.items.map((item) => item.procurementStatus ?? 'UNASSESSED');
    const latestSupplierDelivery = row.telegramDeliveries?.[0];
    return {
      id: row.id,
      status: row.status as OrderStatus,
      participantName: row.conversation.profile?.displayName ?? row.conversation.displayName ??
        (row.conversation.profile?.username ? `@${row.conversation.profile.username}` : null),
      channel: 'INSTAGRAM',
      overallConfidence: row.overallConfidence,
      validationIssues: validationIssues(extraction, row.items),
      customer,
      delivery: extraction.delivery ?? { city: null, address: null, novaPoshtaBranch: null },
      items: row.items.map((item, index) => ({
        ...item,
        quantity: item.quantity ?? extraction.items?.[index]?.quantity ?? 1,
        confidence: item.confidence ?? extraction.items?.[index]?.confidence ?? 0,
        productName: item.catalogId ? products.get(item.catalogId) ?? null : null,
        procurementStatus: item.procurementStatus ?? 'UNASSESSED',
        procurementSource: item.procurementSource ?? null,
        procurementReason: item.procurementReason ?? null,
        stockAtDecision: item.stockAtDecision ?? null,
        availableAtDecision: item.availableAtDecision ?? null,
        reservation: item.reservation ? {
          id: item.reservation.id,
          quantity: item.reservation.quantity,
          status: item.reservation.status,
        } : null,
      })),
      procurementSummary: ['APPROVED', 'AUTO_APPROVED'].includes(row.status)
        ? procurementSummaryFor(procurementStatuses, Boolean(row.procurementHandedOffAt))
        : 'UNASSESSED',
      procurementHandedOffAt: row.procurementHandedOffAt?.toISOString() ?? null,
      supplierDispatch: latestSupplierDelivery ? {
        deliveryId: latestSupplierDelivery.id,
        status: latestSupplierDelivery.status,
        itemCount: latestSupplierDelivery._count.items,
      } : null,
      catalogueCandidates: [...products].map(([sku, name]) => ({ sku, name })),
      createdAt: row.createdAt.toISOString(),
      sheetsExport: row.exports[0] ? this.mapExport(row.exports[0], row.exports[0].destination.status === 'ACTIVE') : null,
    };
  }

  private mapExport(row: { status: string; attempts: number; rowNumber: number | null; lastAttemptAt: Date | null; lastSyncedAt: Date | null; errorSummary: string | null }, destinationActive: boolean): NonNullable<ManagerOrder['sheetsExport']> {
    return {
      status: row.status as NonNullable<ManagerOrder['sheetsExport']>['status'], attempts: row.attempts, rowNumber: row.rowNumber,
      lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null, lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      errorSummary: row.errorSummary, retryAllowed: row.status === 'FAILED' && destinationActive,
    };
  }

  private mapProcurementError(error: unknown): never {
    if (error instanceof ProcurementItemNotFoundError) {
      throw new NotFoundException('Order item not found');
    }
    if (error instanceof InvalidProcurementTransitionError || error instanceof ProcurementOrderNotReadyError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}

function validationIssues(extraction: Extraction, items: Array<{ catalogId: string | null; quantity: number }>): string[] {
  const issues: string[] = [];
  if (extraction.isOrder === false) issues.push('isOrder');
  if (!extraction.customer?.name) issues.push('customer.name');
  if (!extraction.customer?.phone) issues.push('customer.phone');
  if (!extraction.delivery?.city) issues.push('delivery.city');
  if (!extraction.delivery?.novaPoshtaBranch && !extraction.delivery?.address) issues.push('delivery.address');
  if (items.length === 0) issues.push('items');
  items.forEach((item, index) => { if (!item.catalogId) issues.push(`items.${index}.catalogId`); if (item.quantity < 1) issues.push(`items.${index}.quantity`); });
  return issues;
}

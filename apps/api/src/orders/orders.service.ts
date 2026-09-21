import type { ManagerOrder, ManagerOrderUpdate, OrderListResponse, OrderStatus } from '@autosale/contracts/orders';
import { procurementSummaryFor } from '@autosale/contracts/procurement';
import type { ProcurementStatus, ProcurementSummary } from '@autosale/contracts/procurement';
import {
  InvalidProcurementTransitionError,
  materializeCommercialTerms,
  ProcurementItemNotFoundError,
  ProcurementOrderNotReadyError,
  ProcurementStore,
  Prisma,
  type PrismaClient,
  type CommercialLineInput,
} from '@autosale/database';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { metrics } from '@autosale/observability';
import { mapShipmentSummary, shipmentReadiness } from '../delivery/delivery.service.js';
import type { ShipmentStatus } from '@autosale/contracts';
import type { BankAccountSummary, LegalEntitySummary, OrderCommercialTermsSummary } from '@autosale/contracts/commercial';
import type { OrderPaymentStatus } from '@autosale/contracts/payments';
import { calculateOrderPaymentSummary } from '@autosale/database';
import { mapPayment } from './payments.service.js';

type Extraction = {
  isOrder?: boolean;
  customer?: ManagerOrder['customer'];
  delivery?: ManagerOrder['delivery'];
  items?: Array<{ quantity?: number; confidence?: number }>;
};

export type OrderListQuery = {
  search?: string | undefined;
  status?: OrderStatus | undefined;
  procurementStatus?: ProcurementSummary | undefined;
  shipmentStatus?: ShipmentStatus | undefined;
  paymentStatus?: OrderPaymentStatus | undefined;
  page: number;
  pageSize: number;
  sort?: 'product' | 'customer' | 'status' | 'procurement' | 'confidence' | 'date';
  direction?: 'asc' | 'desc';
};

export class OrdersService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly procurement = new ProcurementStore(prisma),
  ) {}

  async list(tenantId: string, query: OrderListQuery): Promise<OrderListResponse> {
    const search = query.search?.trim();
    const paymentOrderIds = query.paymentStatus
      ? await this.paymentOrderIds(tenantId, query.paymentStatus)
      : null;
    if (paymentOrderIds?.length === 0) {
      return { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
    }
    const where: Prisma.OrderWhereInput = {
      tenantId,
      ...(paymentOrderIds ? { id: { in: paymentOrderIds } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.procurementStatus ? { AND: [procurementWhere(query.procurementStatus)] } : {}),
      ...(query.shipmentStatus ? { shipments: { some: { status: query.shipmentStatus } } } : {}),
      ...(search ? {
        OR: [
          { publicNumber: { contains: search, mode: 'insensitive' } },
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
        orderBy: orderListOrderBy(query.sort ?? 'date', query.direction ?? 'desc'),
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
      metrics.increment('autosale_operations_total', { operation: 'procurement_transition', result: 'success' });
    } catch (error) {
      metrics.increment('autosale_operations_total', { operation: 'procurement_transition', result: 'failure' });
      this.mapProcurementError(error);
    }
    return this.detail(tenantId, orderId);
  }

  async handOff(tenantId: string, orderId: string, actor: string): Promise<ManagerOrder> {
    try {
      await this.procurement.handOffOrder(tenantId, orderId, actor);
      metrics.increment('autosale_operations_total', { operation: 'procurement_transition', result: 'success' });
    } catch (error) {
      metrics.increment('autosale_operations_total', { operation: 'procurement_transition', result: 'failure' });
      this.mapProcurementError(error);
    }
    return this.detail(tenantId, orderId);
  }

  async update(tenantId: string, id: string, actor: string, input: ManagerOrderUpdate): Promise<ManagerOrder> {
    const current = await this.find(tenantId, id);
    if (current.procurementHandedOffAt || current.telegramDeliveries.length > 0 || current.shipments.length > 0) {
      throw new BadRequestException('Order cannot be corrected after external fulfillment has started');
    }
    const products = await this.productNames(tenantId);
    const pricing = await this.productPricing(tenantId);
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
      if (input.items !== undefined) {
        const activePayments = await tx.orderPayment.count({ where: { tenantId, orderId: id, cancelledAt: null } });
        if (activePayments > 0) throw new ConflictException('Order items are locked after payment');
      }
      for (const item of input.items ?? []) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            catalogId: item.catalogId,
            quantity: item.quantity,
            color: item.color,
            size: item.size,
          },
        });
      }
      const itemIds = current.items.map((item) => item.id);
      if (itemIds.length > 0) {
        await tx.orderItem.updateMany({
          where: { tenantId, id: { in: itemIds } },
          data: {
            procurementStatus: 'UNASSESSED',
            procurementSource: null,
            procurementReason: null,
            stockAtDecision: null,
            availableAtDecision: null,
            procurementUpdatedAt: null,
          },
        });
        await tx.inventoryReservation.updateMany({
          where: { tenantId, orderItemId: { in: itemIds }, status: 'ACTIVE' },
          data: { status: 'RELEASED', releasedAt: new Date(), consumedAt: null },
        });
      }
      const rows = current.items.map((existing) => ({
        ...existing,
        ...(input.items?.find((item) => item.id === existing.id) ?? {}),
      }));
      const issues = validationIssues(nextExtraction, rows);
      if (current.commercialTerms) {
        const lines: CommercialLineInput[] = rows.map((row) => {
          const submitted = input.items?.find((item) => item.id === row.id);
          const productChanged = submitted !== undefined && submitted.catalogId !== current.items.find((item) => item.id === row.id)?.catalogId;
          const product = row.catalogId ? pricing.get(row.catalogId) : undefined;
          return {
            itemId: row.id,
            quantity: row.quantity,
            unitPrice: productChanged ? product?.price ?? null : row.unitPriceSnapshot?.toFixed(2) ?? null,
            currency: productChanged ? product?.currency ?? null : row.currencySnapshot,
            sourceSku: productChanged ? product?.sku ?? null : row.priceSourceSku,
          };
        });
        await materializeCommercialTerms(tx, {
          tenantId,
          orderId: id,
          actor,
          lines,
          selection: {
            legalEntityId: current.commercialTerms.legalEntityId,
            bankAccountId: current.commercialTerms.bankAccountId,
          },
        });
      }
      const order = await tx.order.update({
        where: { id, tenantId },
        data: {
          extraction: nextExtraction as Prisma.InputJsonObject,
          validationIssues: issues,
          status: 'NEEDS_REVIEW',
          sortCustomer: normalizeSortValue(
            nextExtraction.customer?.name
              ?? current.conversation.profile?.displayName
              ?? current.conversation.displayName
              ?? current.conversation.profile?.username
              ?? '',
          ),
          sortProduct: productSortValue(rows, products),
          sortProcurement: 'UNASSESSED',
        },
        include: this.include,
      });
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
        data: {
          status,
          approvedAt: status === 'APPROVED' ? new Date() : null,
          approvedBy: status === 'APPROVED' ? actor : null,
          ...(!['APPROVED', 'AUTO_APPROVED'].includes(status) ? { sortProcurement: 'UNASSESSED' } : {}),
        },
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
    shipments: {
      orderBy: { createdAt: 'desc' as const },
      take: 1,
      include: { statusEvents: { orderBy: { occurredAt: 'desc' as const } } },
    },
    intentEvaluation: { select: { mode: true, reason: true } },
    commercialTerms: {
      include: {
        bankAccount: true,
        legalEntity: { include: { bankAccounts: { where: { active: true }, orderBy: [{ isDefault: 'desc' as const }, { label: 'asc' as const }] } } },
      },
    },
    payments: {
      orderBy: [{ receivedAt: 'desc' as const }, { createdAt: 'desc' as const }],
      include: {
        creator: { select: { id: true, name: true } },
        canceller: { select: { id: true, name: true } },
        bankAccount: { select: { id: true, label: true } },
      },
    },
  };

  private async productNames(tenantId: string): Promise<Map<string, string>> {
    const products = await this.prisma.product.findMany({ where: { tenantId }, select: { sku: true, name: true } });
    return new Map(products.map((product) => [product.sku, product.name]));
  }

  private async productPricing(tenantId: string): Promise<Map<string, { sku: string; price: string | null; currency: string | null }>> {
    const products = await this.prisma.product.findMany({ where: { tenantId, active: true }, select: { sku: true, price: true, currency: true } });
    return new Map(products.map((product) => [product.sku, { sku: product.sku, price: product.price?.toFixed(2) ?? null, currency: product.currency }]));
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
    const readiness = shipmentReadiness(row);
    return {
      id: row.id,
      publicNumber: row.publicNumber,
      status: row.status as OrderStatus,
      participantName: row.conversation.profile?.displayName ?? row.conversation.displayName ??
        (row.conversation.profile?.username ? `@${row.conversation.profile.username}` : null),
      channel: 'INSTAGRAM',
      overallConfidence: row.overallConfidence,
      validationIssues: validationIssues(extraction, row.items),
      intentDetection: row.intentEvaluation && row.intentEvaluation.mode !== 'PHRASE_ONLY'
        ? {
            mode: row.intentEvaluation.mode as NonNullable<ManagerOrder['intentDetection']>['mode'],
            reason: row.intentEvaluation.reason as NonNullable<ManagerOrder['intentDetection']>['reason'],
          }
        : null,
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
        unitPriceSnapshot: item.unitPriceSnapshot?.toFixed(2) ?? null,
        currencySnapshot: item.currencySnapshot,
        lineTotalSnapshot: item.lineTotalSnapshot?.toFixed(2) ?? null,
      })),
      commercialTerms: row.commercialTerms ? mapCommercialTerms(row.commercialTerms) : null,
      paymentSummary: paymentSummary(row),
      procurementSummary: ['APPROVED', 'AUTO_APPROVED'].includes(row.status)
        ? procurementSummaryFor(procurementStatuses, Boolean(row.procurementHandedOffAt))
        : 'UNASSESSED',
      procurementHandedOffAt: row.procurementHandedOffAt?.toISOString() ?? null,
      supplierDispatch: latestSupplierDelivery ? {
        deliveryId: latestSupplierDelivery.id,
        status: latestSupplierDelivery.status,
        itemCount: latestSupplierDelivery._count.items,
      } : null,
      shipment: row.shipments?.[0] ? mapShipmentSummary(row.shipments[0]) : null,
      canCreateShipment: readiness.allowed,
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

  private async paymentOrderIds(tenantId: string, status: OrderPaymentStatus): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT o.id
      FROM orders o
      JOIN order_commercial_terms ct
        ON ct.order_id = o.id AND ct.tenant_id = o.tenant_id
      LEFT JOIN order_payments p
        ON p.order_id = o.id AND p.tenant_id = o.tenant_id AND p.cancelled_at IS NULL
      WHERE o.tenant_id = ${tenantId}::uuid
        AND ct.pricing_status = 'READY'
        AND ct.total_amount IS NOT NULL
      GROUP BY o.id, ct.total_amount
      HAVING ${paymentStatusPredicate(status)}
    `);
    return rows.map((row) => row.id);
  }
}

function paymentSummary(row: Awaited<ReturnType<OrdersService['find']>>): ManagerOrder['paymentSummary'] {
  const terms = row.commercialTerms;
  if (!terms || terms.pricingStatus !== 'READY' || !terms.totalAmount || !terms.currency) return null;
  const payments = row.payments ?? [];
  const amounts = calculateOrderPaymentSummary(
    terms.totalAmount.toFixed(2),
    payments.map((payment) => ({ amount: payment.amount.toFixed(2), cancelledAt: payment.cancelledAt })),
  );
  return { ...amounts, currency: terms.currency, payments: payments.map(mapPayment) };
}

function paymentStatusPredicate(status: OrderPaymentStatus): Prisma.Sql {
  const paid = Prisma.sql`COALESCE(SUM(p.amount), 0)`;
  switch (status) {
    case 'UNPAID': return Prisma.sql`${paid} = 0`;
    case 'PARTIALLY_PAID': return Prisma.sql`${paid} > 0 AND ${paid} < ct.total_amount`;
    case 'PAID': return Prisma.sql`${paid} = ct.total_amount`;
    case 'OVERPAID': return Prisma.sql`${paid} > ct.total_amount`;
  }
}

function mapLegalEntity(entity: {
  id: string; displayName: string; legalName: string; type: string; registrationId: string | null; active: boolean; isDefault: boolean;
}): LegalEntitySummary {
  return { ...entity, type: entity.type as LegalEntitySummary['type'] };
}

function mapBankAccount(account: {
  id: string; legalEntityId: string; label: string; iban: string; bankName: string | null; currency: string; active: boolean; isDefault: boolean;
}): BankAccountSummary {
  const iban = account.iban.replace(/\s/g, '').toUpperCase();
  return {
    id: account.id, legalEntityId: account.legalEntityId, label: account.label,
    maskedIban: `${iban.slice(0, 2)}••••${iban.slice(-4)}`,
    bankName: account.bankName, currency: account.currency, active: account.active, isDefault: account.isDefault,
  };
}

type CommercialTermsRow = Prisma.OrderCommercialTermsGetPayload<{
  include: { bankAccount: true; legalEntity: { include: { bankAccounts: true } } };
}>;

function mapCommercialTerms(terms: CommercialTermsRow): OrderCommercialTermsSummary {
  return {
    pricingStatus: terms.pricingStatus,
    issueCodes: Array.isArray(terms.issueCodes)
      ? terms.issueCodes.filter((issue): issue is OrderCommercialTermsSummary['issueCodes'][number] => typeof issue === 'string' && ['ITEM_PRICE_MISSING', 'ITEM_CURRENCY_MISSING', 'MIXED_CURRENCIES'].includes(issue))
      : [],
    currency: terms.currency,
    itemsSubtotal: terms.itemsSubtotal?.toFixed(2) ?? null,
    discountAmount: terms.discountAmount.toFixed(2),
    deliveryAmount: terms.deliveryAmount.toFixed(2),
    totalAmount: terms.totalAmount?.toFixed(2) ?? null,
    legalEntity: terms.legalEntity ? mapLegalEntity(terms.legalEntity) : null,
    bankAccount: terms.bankAccount ? mapBankAccount(terms.bankAccount) : null,
    eligibleAccounts: terms.legalEntity?.bankAccounts
      .filter((account) => account.currency === terms.currency)
      .map(mapBankAccount) ?? [],
    version: terms.version,
    legacy: false,
  };
}

function orderListOrderBy(sort: NonNullable<OrderListQuery['sort']>, direction: NonNullable<OrderListQuery['direction']>): Prisma.OrderOrderByWithRelationInput[] {
  const field = ({ product: 'sortProduct', customer: 'sortCustomer', status: 'status', procurement: 'sortProcurement', confidence: 'overallConfidence', date: 'createdAt' } as const)[sort];
  const primary: Prisma.OrderOrderByWithRelationInput = field === 'overallConfidence'
    ? { overallConfidence: { sort: direction, nulls: 'last' } }
    : { [field]: direction };
  return [primary, { id: 'asc' }];
}

function procurementWhere(summary: ProcurementSummary): Prisma.OrderWhereInput {
  if (summary === 'HANDED_OFF') return { procurementHandedOffAt: { not: null } };
  if (summary === 'UNASSESSED') {
    return {
      procurementHandedOffAt: null,
      OR: [
        { status: { notIn: ['APPROVED', 'AUTO_APPROVED'] } },
        { items: { none: {} } },
        { items: { some: { procurementStatus: 'UNASSESSED' } } },
      ],
    };
  }

  const approved: Prisma.OrderWhereInput = {
    status: { in: ['APPROVED', 'AUTO_APPROVED'] },
    procurementHandedOffAt: null,
  };
  if (summary === 'BLOCKED') return { ...approved, items: { some: { procurementStatus: 'UNAVAILABLE' } } };
  if (summary === 'SENDING') {
    return {
      ...approved,
      items: {
        some: { procurementStatus: 'SENDING' },
        none: { procurementStatus: 'UNAVAILABLE' },
      },
    };
  }
  if (summary === 'READY') {
    return {
      ...approved,
      items: {
        some: { procurementStatus: { in: ['IN_STOCK', 'RECEIVED'] } },
        every: { procurementStatus: { in: ['IN_STOCK', 'RECEIVED'] } },
      },
    };
  }
  if (summary === 'NEEDS_ORDER') {
    return {
      ...approved,
      items: {
        some: { procurementStatus: 'TO_ORDER' },
        every: { procurementStatus: 'TO_ORDER' },
      },
    };
  }
  if (summary === 'AWAITING_SUPPLIER') {
    return {
      ...approved,
      items: {
        some: { procurementStatus: { in: ['ORDERED', 'SUPPLIER_CONFIRMED'] } },
        every: { procurementStatus: { in: ['ORDERED', 'SUPPLIER_CONFIRMED'] } },
      },
    };
  }
  return {
    ...approved,
    AND: [
      { items: { none: { procurementStatus: { in: ['UNASSESSED', 'UNAVAILABLE', 'SENDING'] } } } },
      { OR: [
        { AND: [
          { items: { some: { procurementStatus: { in: ['IN_STOCK', 'RECEIVED'] } } } },
          { items: { some: { procurementStatus: { in: ['TO_ORDER', 'ORDERED', 'SUPPLIER_CONFIRMED'] } } } },
        ] },
        { AND: [
          { items: { some: { procurementStatus: 'TO_ORDER' } } },
          { items: { some: { procurementStatus: { in: ['ORDERED', 'SUPPLIER_CONFIRMED'] } } } },
        ] },
      ] },
    ],
  };
}

function normalizeSortValue(value: string): string {
  return value.trim().toLocaleLowerCase('uk-UA');
}

function productSortValue(
  items: Array<{ catalogId: string | null; originalText: string }>,
  products: Map<string, string>,
): string {
  return normalizeSortValue(items.map((item) => item.catalogId ? products.get(item.catalogId) ?? item.originalText : item.originalText).filter(Boolean).join(', '));
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

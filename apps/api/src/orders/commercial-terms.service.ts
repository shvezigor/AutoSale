import type {
  BankAccountSummary,
  CommercialTermsUpdate,
  LegalEntitySummary,
  OrderCommercialTermsSummary,
} from '@autosale/contracts/commercial';
import { calculateCommercialTerms, materializeCommercialTerms, Prisma, type CommercialLineInput, type PrismaClient } from '@autosale/database';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export class CommercialTermsService {
  constructor(private readonly prisma: PrismaClient) {}

  async preview(tenantId: string, orderId: string): Promise<OrderCommercialTermsSummary> {
    const context = await this.orderContext(tenantId, orderId);
    const calculation = calculateCommercialTerms(await this.currentCatalogueLines(tenantId, context.items));
    const legalEntity = await this.prisma.tenantLegalEntity.findFirst({
      where: { tenantId, active: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    const accounts = legalEntity && calculation.currency
      ? await this.prisma.tenantBankAccount.findMany({
          where: { tenantId, legalEntityId: legalEntity.id, currency: calculation.currency, active: true },
          orderBy: [{ isDefault: 'desc' }, { label: 'asc' }],
        })
      : [];
    return {
      ...summaryAmounts(calculation),
      legalEntity: legalEntity ? mapLegalEntity(legalEntity) : null,
      bankAccount: accounts[0] ? mapBankAccount(accounts[0]) : null,
      eligibleAccounts: accounts.map(mapBankAccount),
      version: 0,
      legacy: true,
    };
  }

  async update(
    tenantId: string,
    orderId: string,
    actor: string,
    input: CommercialTermsUpdate,
  ): Promise<OrderCommercialTermsSummary> {
    const context = await this.orderContext(tenantId, orderId);
    this.assertCorrectable(context);
    const current = await this.prisma.orderCommercialTerms.findFirst({ where: { tenantId, orderId } });
    if (!current) {
      if (!input.initializeLegacy || input.version !== 0) throw new ConflictException('Commercial terms must be initialized from a preview');
      const lines = await this.currentCatalogueLines(tenantId, context.items);
      await this.prisma.$transaction(async (tx) => {
        await this.assertNoActivePayments(tx, tenantId, orderId);
        await materializeCommercialTerms(tx, { tenantId, orderId, actor, lines });
        await this.applySelection(tx, tenantId, orderId, input.legalEntityId, input.bankAccountId, actor);
        await tx.auditLog.create({ data: {
          tenantId, orderId, actor, action: 'ORDER_COMMERCIAL_TERMS_INITIALIZED',
          changes: { legalEntityId: input.legalEntityId, bankAccountId: input.bankAccountId },
        } });
      });
      return this.get(tenantId, orderId);
    }
    if (current.version !== input.version) throw new ConflictException('Commercial terms changed; reload and try again');
    await this.prisma.$transaction(async (tx) => {
      await this.assertNoActivePayments(tx, tenantId, orderId);
      const selected = await this.validateSelection(tx, tenantId, current.currency, input.legalEntityId, input.bankAccountId);
      const result = await tx.orderCommercialTerms.updateMany({
        where: { id: current.id, tenantId, version: input.version },
        data: {
          legalEntityId: selected.entity?.id ?? null,
          bankAccountId: selected.account?.id ?? null,
          legalEntitySnapshot: selected.entity ? legalEntitySnapshot(selected.entity) : Prisma.JsonNull,
          bankAccountSnapshot: selected.account ? bankAccountSnapshot(selected.account) : Prisma.JsonNull,
          updatedBy: actor,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw new ConflictException('Commercial terms changed; reload and try again');
      await tx.auditLog.create({ data: {
        tenantId, orderId, actor, action: 'ORDER_COMMERCIAL_TERMS_UPDATED',
        changes: { legalEntityId: input.legalEntityId, bankAccountId: input.bankAccountId },
      } });
    });
    return this.get(tenantId, orderId);
  }

  async get(tenantId: string, orderId: string): Promise<OrderCommercialTermsSummary> {
    const terms = await this.prisma.orderCommercialTerms.findFirst({
      where: { tenantId, orderId },
      include: { legalEntity: true, bankAccount: true },
    });
    if (!terms) throw new NotFoundException('Commercial terms not found');
    const accounts = terms.legalEntityId && terms.currency
      ? await this.prisma.tenantBankAccount.findMany({
          where: { tenantId, legalEntityId: terms.legalEntityId, currency: terms.currency, active: true },
          orderBy: [{ isDefault: 'desc' }, { label: 'asc' }],
        })
      : [];
    return {
      pricingStatus: terms.pricingStatus,
      issueCodes: issueCodes(terms.issueCodes),
      currency: terms.currency,
      itemsSubtotal: terms.itemsSubtotal?.toFixed(2) ?? null,
      discountAmount: terms.discountAmount.toFixed(2),
      deliveryAmount: terms.deliveryAmount.toFixed(2),
      totalAmount: terms.totalAmount?.toFixed(2) ?? null,
      legalEntity: terms.legalEntity ? mapLegalEntity(terms.legalEntity) : null,
      bankAccount: terms.bankAccount ? mapBankAccount(terms.bankAccount) : null,
      eligibleAccounts: accounts.map(mapBankAccount),
      version: terms.version,
      legacy: false,
    };
  }

  private async applySelection(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
    legalEntityId: string | null,
    bankAccountId: string | null,
    actor: string,
  ): Promise<void> {
    const terms = await tx.orderCommercialTerms.findUniqueOrThrow({ where: { orderId } });
    const selected = await this.validateSelection(tx, tenantId, terms.currency, legalEntityId, bankAccountId);
    await tx.orderCommercialTerms.update({ where: { orderId }, data: {
      legalEntityId: selected.entity?.id ?? null,
      bankAccountId: selected.account?.id ?? null,
      legalEntitySnapshot: selected.entity ? legalEntitySnapshot(selected.entity) : Prisma.JsonNull,
      bankAccountSnapshot: selected.account ? bankAccountSnapshot(selected.account) : Prisma.JsonNull,
      updatedBy: actor,
    } });
  }

  private async assertNoActivePayments(
    tx: Pick<Prisma.TransactionClient, 'orderPayment'>,
    tenantId: string,
    orderId: string,
  ): Promise<void> {
    const activePayments = await tx.orderPayment.count({ where: { tenantId, orderId, cancelledAt: null } });
    if (activePayments > 0) throw new ConflictException('Commercial terms are locked after payment');
  }

  private async validateSelection(
    tx: Pick<Prisma.TransactionClient, 'tenantLegalEntity' | 'tenantBankAccount'>,
    tenantId: string,
    currency: string | null,
    legalEntityId: string | null,
    bankAccountId: string | null,
  ) {
    const entity = legalEntityId
      ? await tx.tenantLegalEntity.findFirst({ where: { id: legalEntityId, tenantId, active: true } })
      : null;
    if (legalEntityId && !entity) throw new BadRequestException('Legal entity is not active or does not exist');
    if (bankAccountId && (!entity || !currency)) throw new BadRequestException('Select a legal entity and priced currency first');
    const account = bankAccountId
      ? await tx.tenantBankAccount.findFirst({ where: { id: bankAccountId, tenantId, legalEntityId: entity!.id, currency: currency!, active: true } })
      : null;
    if (bankAccountId && !account) throw new BadRequestException('Bank account does not match legal entity and currency');
    return { entity, account };
  }

  private async orderContext(tenantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        telegramDeliveries: { where: { purpose: 'SUPPLIER_ORDER' }, take: 1 },
        shipments: { take: 1 },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private assertCorrectable(order: { procurementHandedOffAt: Date | null; telegramDeliveries: unknown[]; shipments: unknown[] }): void {
    if (order.procurementHandedOffAt || order.telegramDeliveries.length > 0 || order.shipments.length > 0) {
      throw new BadRequestException('Commercial terms cannot change after external fulfillment has started');
    }
  }

  private async currentCatalogueLines(
    tenantId: string,
    items: Array<{ id: string; catalogId: string | null; quantity: number }>,
  ): Promise<CommercialLineInput[]> {
    const skus = [...new Set(items.flatMap((item) => item.catalogId ? [item.catalogId] : []))];
    const products = await this.prisma.product.findMany({ where: { tenantId, sku: { in: skus }, active: true } });
    const bySku = new Map(products.map((product) => [product.sku, product]));
    return items.map((item) => {
      const product = item.catalogId ? bySku.get(item.catalogId) : undefined;
      return {
        itemId: item.id,
        quantity: item.quantity,
        unitPrice: product?.price?.toFixed(2) ?? null,
        currency: product?.currency ?? null,
        sourceSku: product?.sku ?? null,
      };
    });
  }
}

function summaryAmounts(calculation: ReturnType<typeof calculateCommercialTerms>) {
  return {
    pricingStatus: calculation.pricingStatus,
    issueCodes: calculation.issueCodes,
    currency: calculation.currency,
    itemsSubtotal: calculation.itemsSubtotal,
    discountAmount: '0.00',
    deliveryAmount: '0.00',
    totalAmount: calculation.totalAmount,
  };
}

function mapLegalEntity(entity: { id: string; displayName: string; legalName: string; type: string; registrationId: string | null; active: boolean; isDefault: boolean }): LegalEntitySummary {
  return { ...entity, type: entity.type as LegalEntitySummary['type'] };
}

function mapBankAccount(account: { id: string; legalEntityId: string; label: string; iban: string; bankName: string | null; currency: string; active: boolean; isDefault: boolean }): BankAccountSummary {
  const iban = account.iban.replace(/\s/g, '').toUpperCase();
  return { id: account.id, legalEntityId: account.legalEntityId, label: account.label, maskedIban: `${iban.slice(0, 2)}••••${iban.slice(-4)}`, bankName: account.bankName, currency: account.currency, active: account.active, isDefault: account.isDefault };
}

function issueCodes(value: Prisma.JsonValue) {
  return Array.isArray(value)
    ? value.filter((item): item is OrderCommercialTermsSummary['issueCodes'][number] => typeof item === 'string' && ['ITEM_PRICE_MISSING', 'ITEM_CURRENCY_MISSING', 'MIXED_CURRENCIES'].includes(item))
    : [];
}

function legalEntitySnapshot(entity: { displayName: string; legalName: string; type: string; registrationId: string | null }): Prisma.InputJsonObject {
  return { displayName: entity.displayName, legalName: entity.legalName, type: entity.type, ...(entity.registrationId ? { registrationId: entity.registrationId } : {}) };
}

function bankAccountSnapshot(account: { label: string; iban: string; bankName: string | null; currency: string }): Prisma.InputJsonObject {
  return { label: account.label, iban: account.iban, currency: account.currency, ...(account.bankName ? { bankName: account.bankName } : {}) };
}

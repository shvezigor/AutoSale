import { Prisma } from './generated/prisma/client.js';

export type CommercialIssueCode = 'ITEM_PRICE_MISSING' | 'ITEM_CURRENCY_MISSING' | 'MIXED_CURRENCIES';

export type CommercialLineInput = {
  itemId: string;
  quantity: number;
  unitPrice: string | null;
  currency: string | null;
  sourceSku: string | null;
};

export type CommercialCalculation = {
  pricingStatus: 'READY' | 'NEEDS_REVIEW';
  currency: string | null;
  itemsSubtotal: string | null;
  totalAmount: string | null;
  issueCodes: CommercialIssueCode[];
  lines: Array<CommercialLineInput & { lineTotal: string | null }>;
};

export function calculateCommercialTerms(lines: CommercialLineInput[]): CommercialCalculation {
  const issues = new Set<CommercialIssueCode>();
  const normalizedCurrencies = new Set<string>();
  const calculatedLines = lines.map((line) => {
    const currency = normalizeCurrency(line.currency);
    if (line.unitPrice === null) issues.add('ITEM_PRICE_MISSING');
    if (currency === null) issues.add('ITEM_CURRENCY_MISSING');
    if (currency !== null) normalizedCurrencies.add(currency);
    const lineTotal = line.unitPrice === null
      ? null
      : money(new Prisma.Decimal(line.unitPrice).mul(line.quantity));
    return { ...line, currency, lineTotal };
  });
  if (normalizedCurrencies.size > 1) issues.add('MIXED_CURRENCIES');
  const issueCodes = issueOrder.filter((issue) => issues.has(issue));
  if (issueCodes.length > 0) {
    return {
      pricingStatus: 'NEEDS_REVIEW',
      currency: null,
      itemsSubtotal: null,
      totalAmount: null,
      issueCodes,
      lines: calculatedLines,
    };
  }
  const subtotal = calculatedLines.reduce(
    (sum, line) => sum.add(line.lineTotal ?? '0'),
    new Prisma.Decimal(0),
  );
  const total = money(subtotal);
  return {
    pricingStatus: 'READY',
    currency: normalizedCurrencies.values().next().value ?? null,
    itemsSubtotal: total,
    totalAmount: total,
    issueCodes: [],
    lines: calculatedLines,
  };
}

export async function materializeCommercialTerms(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    orderId: string;
    actor: string;
    lines: CommercialLineInput[];
    selection?: { legalEntityId: string | null; bankAccountId: string | null };
  },
): Promise<CommercialCalculation> {
  const calculation = calculateCommercialTerms(input.lines);
  const selectedEntity = input.selection?.legalEntityId
    ? await tx.tenantLegalEntity.findFirst({ where: { id: input.selection.legalEntityId, tenantId: input.tenantId, active: true } })
    : null;
  const legalEntity = input.selection !== undefined
    ? selectedEntity
    : await tx.tenantLegalEntity.findFirst({
        where: { tenantId: input.tenantId, active: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
  const selectedAccount = legalEntity && calculation.currency && input.selection?.bankAccountId
    ? await tx.tenantBankAccount.findFirst({ where: {
        id: input.selection.bankAccountId,
        tenantId: input.tenantId,
        legalEntityId: legalEntity.id,
        currency: calculation.currency,
        active: true,
      } })
    : null;
  const bankAccount = input.selection !== undefined
    ? selectedAccount
    : legalEntity && calculation.currency
      ? await tx.tenantBankAccount.findFirst({
        where: {
          tenantId: input.tenantId,
          legalEntityId: legalEntity.id,
          currency: calculation.currency,
          active: true,
        },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        })
      : null;
  for (const line of calculation.lines) {
    await tx.orderItem.updateMany({
      where: { id: line.itemId, tenantId: input.tenantId, orderId: input.orderId },
      data: {
        unitPriceSnapshot: line.unitPrice,
        currencySnapshot: line.currency,
        lineTotalSnapshot: line.lineTotal,
        priceSourceSku: line.sourceSku,
      },
    });
  }
  await tx.orderCommercialTerms.upsert({
    where: { orderId: input.orderId },
    create: {
      tenantId: input.tenantId,
      orderId: input.orderId,
      legalEntityId: legalEntity?.id ?? null,
      bankAccountId: bankAccount?.id ?? null,
      currency: calculation.currency,
      itemsSubtotal: calculation.itemsSubtotal,
      totalAmount: calculation.totalAmount,
      pricingStatus: calculation.pricingStatus,
      issueCodes: calculation.issueCodes,
      legalEntitySnapshot: legalEntity ? legalEntitySnapshot(legalEntity) : Prisma.JsonNull,
      bankAccountSnapshot: bankAccount ? bankAccountSnapshot(bankAccount) : Prisma.JsonNull,
      updatedBy: input.actor,
    },
    update: {
      legalEntityId: legalEntity?.id ?? null,
      bankAccountId: bankAccount?.id ?? null,
      currency: calculation.currency,
      itemsSubtotal: calculation.itemsSubtotal,
      totalAmount: calculation.totalAmount,
      pricingStatus: calculation.pricingStatus,
      issueCodes: calculation.issueCodes,
      legalEntitySnapshot: legalEntity ? legalEntitySnapshot(legalEntity) : Prisma.JsonNull,
      bankAccountSnapshot: bankAccount ? bankAccountSnapshot(bankAccount) : Prisma.JsonNull,
      updatedBy: input.actor,
      version: { increment: 1 },
    },
  });
  return calculation;
}

const issueOrder: CommercialIssueCode[] = [
  'ITEM_PRICE_MISSING',
  'ITEM_CURRENCY_MISSING',
  'MIXED_CURRENCIES',
];

function normalizeCurrency(value: string | null): string | null {
  const normalized = value?.trim().toUpperCase() ?? '';
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function money(value: InstanceType<typeof Prisma.Decimal>): string {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function legalEntitySnapshot(entity: {
  displayName: string; legalName: string; type: string; registrationId: string | null;
}): Prisma.InputJsonObject {
  return {
    displayName: entity.displayName,
    legalName: entity.legalName,
    type: entity.type,
    ...(entity.registrationId ? { registrationId: entity.registrationId } : {}),
  };
}

function bankAccountSnapshot(account: {
  label: string; iban: string; bankName: string | null; currency: string;
}): Prisma.InputJsonObject {
  return {
    label: account.label,
    iban: account.iban,
    currency: account.currency,
    ...(account.bankName ? { bankName: account.bankName } : {}),
  };
}

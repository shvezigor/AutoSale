import type { Prisma } from '@autosale/database';

export type TenantExportDataset = {
  name: string;
  fields: readonly string[];
  page: (
    tx: Prisma.TransactionClient,
    tenantId: string,
    afterId: string | null,
    take: number,
  ) => Promise<readonly Record<string, Prisma.JsonValue>[]>;
};

export type TenantExportObjectReference = {
  key: string;
  purpose: 'attachment' | 'customer_avatar' | 'user_avatar' | 'catalogue_source' | 'catalogue_snapshot';
};

type FindManyDelegate = {
  findMany(input: Record<string, unknown>): Promise<Record<string, unknown>[]>;
};

function dataset(
  name: string,
  delegateName: string,
  select: Record<string, unknown>,
  options: { tenantField?: string; extraWhere?: Record<string, unknown> } = {},
): TenantExportDataset {
  const fields = Object.keys(select);
  return {
    name,
    fields,
    async page(tx, tenantId, afterId, take) {
      const delegate = (tx as unknown as Record<string, FindManyDelegate>)[delegateName];
      if (!delegate) throw new Error(`TENANT_EXPORT_DATASET_UNAVAILABLE:${name}`);
      const tenantField = options.tenantField ?? 'tenantId';
      const rows = await delegate.findMany({
        where: { [tenantField]: tenantId, ...options.extraWhere },
        select,
        orderBy: { id: 'asc' },
        take,
        ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
      });
      return rows.map(toJsonRecord);
    },
  };
}

const identityFields = { id: true, tenantId: true, createdAt: true };

export const TENANT_EXPORT_DATASETS: readonly TenantExportDataset[] = [
  dataset('tenants', 'tenant', {
    id: true, key: true, name: true, status: true, createdAt: true, updatedAt: true,
  }, { tenantField: 'id' }),
  dataset('conversations', 'conversation', {
    ...identityFields, channel: true, externalConversationId: true, participantId: true,
    profileId: true, displayName: true, lastMessageAt: true, updatedAt: true,
  }),
  dataset('instagram-customer-profiles', 'instagramCustomerProfile', {
    ...identityFields, participantId: true, displayName: true, username: true,
    avatarChecksum: true, avatarContentType: true, status: true, lastRefreshedAt: true, updatedAt: true,
  }),
  dataset('messages', 'message', {
    ...identityFields, conversationId: true, channel: true, externalMessageId: true,
    direction: true, senderId: true, text: true, sourceTimestamp: true,
    sentByUserId: true, providerMessageId: true, deliveryStatus: true,
  }),
  dataset('orders', 'order', {
    ...identityFields, publicNumber: true, conversationId: true, triggerMessageId: true,
    status: true, extraction: true, validationIssues: true, overallConfidence: true,
    approvedAt: true, approvedBy: true, procurementHandedOffAt: true, procurementHandedOffBy: true,
    updatedAt: true,
  }),
  dataset('order-items', 'orderItem', {
    ...identityFields, orderId: true, catalogId: true, originalText: true, quantity: true,
    color: true, size: true, confidence: true, unitPriceSnapshot: true, currencySnapshot: true,
    lineTotalSnapshot: true, priceSourceSku: true, procurementStatus: true,
    procurementSource: true, procurementReason: true, stockAtDecision: true, availableAtDecision: true,
    procurementUpdatedAt: true,
  }),
  dataset('products', 'product', {
    ...identityFields, sku: true, name: true, description: true, price: true, currency: true,
    stockQuantity: true, category: true, brand: true, aliases: true, color: true, size: true,
    imageUrls: true, attributes: true, imageUrl: true, active: true, sourceId: true,
    sourceRowKey: true, sourceUpdatedAt: true, updatedAt: true,
  }),
  dataset('payments', 'orderPayment', {
    ...identityFields, orderId: true, amount: true, currency: true, method: true,
    receivedAt: true, bankAccountId: true, carrier: true, note: true, createdBy: true,
    cancelledAt: true, cancelledBy: true, cancellationReason: true,
  }),
  dataset('shipments', 'shipment', {
    ...identityFields, orderId: true, connectionId: true, createdByUserId: true, provider: true,
    status: true, senderSnapshot: true, recipientSnapshot: true, destinationSnapshot: true,
    parcels: true, payer: true, declaredValue: true, codAmount: true, description: true,
    providerDocumentId: true, trackingNumber: true, cost: true, currency: true,
    providerCreatedAt: true, acceptedAt: true, deliveredAt: true, cancelledAt: true, updatedAt: true,
  }),
  dataset('delivery-events', 'shipmentStatusEvent', {
    ...identityFields, shipmentId: true, status: true, providerCode: true,
    providerEventKey: true, providerOccurredAt: true, occurredAt: true, mappingVersion: true,
  }),
  dataset('tenant-settings', 'tenantSettings', {
    ...identityFields, intentDetectionMode: true, approvalMode: true,
    autoApprovalThreshold: true, promptVersion: true, triggerPhrases: true, updatedAt: true,
  }),
  dataset('memberships', 'tenantMembership', {
    ...identityFields, userId: true, role: true, status: true, updatedAt: true,
    user: { select: { id: true, email: true, name: true, phone: true, locale: true, status: true, createdAt: true } },
  }),
  dataset('instagram-connections', 'instagramConnection', {
    ...identityFields, externalAccountId: true, displayName: true, status: true,
    lastVerifiedAt: true, lastErrorCode: true, disconnectedAt: true, updatedAt: true,
  }),
  dataset('google-connections', 'googleConnection', {
    ...identityFields, googleSubject: true, accountEmail: true, status: true,
    lastVerifiedAt: true, lastErrorCode: true, disconnectedAt: true, updatedAt: true,
  }),
  dataset('telegram-bindings', 'telegramUserBinding', {
    id: true, tenantId: true, userId: true, telegramUserId: true, privateChatId: true,
    displayName: true, username: true, linkedAt: true, revokedAt: true, updatedAt: true,
  }),
  dataset('delivery-connections', 'deliveryConnection', {
    ...identityFields, provider: true, status: true, accountLabel: true,
    connectedByUserId: true, lastVerifiedAt: true, lastErrorCode: true,
    disconnectedAt: true, updatedAt: true,
  }),
  dataset('legal-entities', 'tenantLegalEntity', {
    ...identityFields, displayName: true, legalName: true, type: true,
    registrationId: true, active: true, isDefault: true, updatedAt: true,
  }),
  dataset('bank-accounts', 'tenantBankAccount', {
    ...identityFields, legalEntityId: true, label: true, iban: true,
    bankName: true, currency: true, active: true, isDefault: true, updatedAt: true,
  }),
];

export async function listTenantObjectReferences(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<TenantExportObjectReference[]> {
  const [attachments, customerAvatars, userAvatars, sources, snapshots] = await Promise.all([
    tx.attachment.findMany({
      where: { message: { tenantId }, storageKey: { not: null } },
      select: { storageKey: true },
      orderBy: { id: 'asc' },
    }),
    tx.instagramCustomerProfile.findMany({
      where: { tenantId, avatarStorageKey: { not: null } },
      select: { avatarStorageKey: true },
      orderBy: { id: 'asc' },
    }),
    tx.tenantMembership.findMany({
      where: { tenantId, user: { avatarStorageKey: { not: null } } },
      select: { user: { select: { avatarStorageKey: true } } },
      orderBy: { id: 'asc' },
    }),
    tx.catalogueSource.findMany({
      where: { tenantId, objectKey: { not: null } },
      select: { objectKey: true },
      orderBy: { id: 'asc' },
    }),
    tx.catalogueImportRun.findMany({
      where: { tenantId, snapshotObjectKey: { not: null } },
      select: { snapshotObjectKey: true },
      orderBy: { id: 'asc' },
    }),
  ]);

  const references: TenantExportObjectReference[] = [
    ...attachments.flatMap((row) => row.storageKey ? [{ key: row.storageKey, purpose: 'attachment' as const }] : []),
    ...customerAvatars.flatMap((row) => row.avatarStorageKey ? [{ key: row.avatarStorageKey, purpose: 'customer_avatar' as const }] : []),
    ...userAvatars.flatMap((row) => row.user.avatarStorageKey ? [{ key: row.user.avatarStorageKey, purpose: 'user_avatar' as const }] : []),
    ...sources.flatMap((row) => row.objectKey ? [{ key: row.objectKey, purpose: 'catalogue_source' as const }] : []),
    ...snapshots.flatMap((row) => row.snapshotObjectKey ? [{ key: row.snapshotObjectKey, purpose: 'catalogue_snapshot' as const }] : []),
  ];
  const unique = new Map(references.map((reference) => [`${reference.purpose}:${reference.key}`, reference]));
  return [...unique.values()].sort((left, right) => compareText(left.key, right.key) || compareText(left.purpose, right.purpose));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toJsonRecord(row: Record<string, unknown>): Record<string, Prisma.JsonValue> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toJsonValue(value)]));
}

function toJsonValue(value: unknown): Prisma.JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === 'object') {
    const serializable = value as { toJSON?: () => unknown };
    if (typeof serializable.toJSON === 'function') return toJsonValue(serializable.toJSON());
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, toJsonValue(nested)]));
  }
  return String(value);
}

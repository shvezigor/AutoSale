import { createHash } from 'node:crypto';

import { Prisma, type PrismaClient } from './generated/prisma/client.js';

export type CatalogueTarget = 'sku' | 'name' | 'description' | 'price' | 'currency' | 'stockQuantity'
  | 'category' | 'brand' | 'aliases' | 'color' | 'size' | 'imageUrls' | 'active' | 'attributes' | 'ignore';
export type CatalogueCell = string | number | boolean | null;
export type CatalogueColumn = { source: string; target: CatalogueTarget };
export type CatalogueTableInput = {
  tenantId: string;
  sourceId: string;
  /** File snapshots may replace tenant-wide SKUs; live Google sources may only update their own SKUs. */
  ownershipPolicy?: 'REASSIGN' | 'FENCE_CROSS_SOURCE';
  /** A renewable Google source lease, fenced immediately before the product transaction commits. */
  lease?: { id: string; syncVersion: number; ttlMs: number };
  headers: string[];
  rows: CatalogueCell[][];
  mapping: CatalogueColumn[];
  transformSettings: unknown;
};

export type CatalogueImportProduct = {
  sku: string; name: string; description?: string | null; price?: number | null; currency?: string | null;
  stockQuantity?: number | null; category?: string | null; brand?: string | null; aliases: string[];
  color?: string | null; size?: string | null; imageUrls: string[]; attributes: Record<string, unknown>; active: boolean;
};
export type CatalogueImportPlanRow = {
  rowNumber: number;
  product?: CatalogueImportProduct;
  errors: string[];
  codes: string[];
  presentTargets: Set<CatalogueTarget>;
};
export type CatalogueImportPlan = {
  rows: CatalogueImportPlanRow[];
  totals: { created: number; updated: number; skipped: number; failed: number };
};
export type CatalogueImportCounts = {
  totalRows: number; validRows: number; createdRows: number; updatedRows: number; skippedRows: number; failedRows: number;
  rowErrors: Array<{ rowNumber: number; errors: string[] }>;
};

export class CatalogueSkuOwnershipError extends Error {
  override readonly name = 'CatalogueSkuOwnershipError';
  constructor() { super('Catalogue SKU belongs to another source'); }
}

export class CatalogueImportLeaseLostError extends Error {
  override readonly name = 'CatalogueImportLeaseLostError';
  constructor() { super('Catalogue synchronization lease was lost'); }
}

export async function buildCatalogueImportPlan(prisma: Pick<PrismaClient, 'product'>, input: CatalogueTableInput): Promise<CatalogueImportPlan> {
  const headerIndex = new Map(input.headers.map((header, index) => [normalizeHeader(header), index]));
  const normalizedMapping = input.mapping.map((column) => ({ ...column, source: normalizeHeader(column.source) }));
  const clearFields = readClearFields(input.transformSettings);
  const rows = input.rows.map((values, index) => mapRow(values, index + 2, input.sourceId, headerIndex, normalizedMapping, clearFields));
  const skuRows = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.product?.sku) continue;
    const numbers = skuRows.get(row.product.sku) ?? [];
    numbers.push(row.rowNumber);
    skuRows.set(row.product.sku, numbers);
  }
  for (const row of rows) {
    const duplicates = row.product ? skuRows.get(row.product.sku) : undefined;
    if (!duplicates || duplicates.length < 2) continue;
    const other = duplicates.find((number) => number !== row.rowNumber)!;
    row.errors.push(`Duplicate SKU also appears on row ${other}`);
    row.codes.push('SKU_DUPLICATE');
    delete row.product;
  }
  const validSkus = rows.flatMap((row) => row.product && row.errors.length === 0 ? [row.product.sku] : []);
  const existing = validSkus.length === 0 ? [] : await prisma.product.findMany({
    where: { tenantId: input.tenantId, sku: { in: validSkus } }, select: { sku: true },
  });
  const existingSkus = new Set(existing.map((product) => product.sku));
  return {
    rows,
    totals: {
      created: rows.filter((row) => row.product && row.errors.length === 0 && !existingSkus.has(row.product.sku)).length,
      updated: rows.filter((row) => row.product && row.errors.length === 0 && existingSkus.has(row.product.sku)).length,
      skipped: rows.filter((row) => row.codes.includes('EMPTY_ROW')).length,
      failed: rows.filter((row) => row.errors.length > 0).length,
    },
  };
}

export async function importCatalogueTable(prisma: PrismaClient, input: CatalogueTableInput): Promise<CatalogueImportCounts> {
  const plan = await buildCatalogueImportPlan(prisma, input);
  const validRows = plan.rows.filter((row): row is CatalogueImportPlanRow & { product: CatalogueImportProduct } => Boolean(row.product) && row.errors.length === 0);
  await upsertCatalogueProducts(prisma, {
    tenantId: input.tenantId, sourceId: input.sourceId, rows: validRows,
    ownershipPolicy: input.ownershipPolicy ?? 'FENCE_CROSS_SOURCE', lease: input.lease,
  });
  return {
    totalRows: plan.rows.length,
    validRows: validRows.length,
    createdRows: plan.totals.created,
    updatedRows: plan.totals.updated,
    skippedRows: plan.totals.skipped,
    failedRows: plan.totals.failed,
    rowErrors: plan.rows.filter((row) => row.codes.length > 0).slice(0, 100).map((row) => ({ rowNumber: row.rowNumber, errors: row.codes })),
  };
}

export async function upsertCatalogueProducts(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    sourceId: string;
    rows: Array<{ rowNumber: number; product: CatalogueImportProduct; presentTargets: ReadonlySet<string> }>;
    ownershipPolicy?: 'REASSIGN' | 'FENCE_CROSS_SOURCE';
    lease?: { id: string; syncVersion: number; ttlMs: number } | undefined;
    batchSize?: number;
  },
): Promise<void> {
  await catalogueWriteRetry(prisma, async (tx) => {
    await lockTenantCatalogueWrites(tx, input.tenantId);
    if (input.lease) await assertImportLeaseOwned(tx, input, input.lease);
    const owned = await tx.product.findMany({
      where: { tenantId: input.tenantId, sku: { in: input.rows.map((row) => row.product.sku) } },
      select: { sku: true, sourceId: true },
    });
    if ((input.ownershipPolicy ?? 'FENCE_CROSS_SOURCE') === 'FENCE_CROSS_SOURCE'
      && owned.some((product) => product.sourceId !== null && product.sourceId !== input.sourceId)) {
      throw new CatalogueSkuOwnershipError();
    }
    for (const row of input.rows) {
      await tx.product.upsert({
        where: { tenantId_sku: { tenantId: input.tenantId, sku: row.product.sku } },
        create: productCreate(input.tenantId, input.sourceId, row),
        update: productUpdate(input.sourceId, row),
      });
    }
    if (input.lease) await fenceImportLease(tx, input, input.lease);
  });
}

async function lockTenantCatalogueWrites(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))::text`);
}

async function assertImportLeaseOwned(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; sourceId: string },
  lease: { id: string; syncVersion: number },
): Promise<void> {
  const owned = await tx.catalogueSource.findFirst({
    where: {
      id: input.sourceId, tenantId: input.tenantId, type: 'GOOGLE_SHEETS', syncLeaseId: lease.id,
      syncVersion: lease.syncVersion, syncLeaseExpiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (!owned) throw new CatalogueImportLeaseLostError();
}

async function fenceImportLease(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; sourceId: string },
  lease: { id: string; syncVersion: number },
): Promise<void> {
  const now = new Date();
  const fenced = await tx.catalogueSource.updateMany({
    where: {
      id: input.sourceId, tenantId: input.tenantId, type: 'GOOGLE_SHEETS', syncLeaseId: lease.id,
      syncVersion: lease.syncVersion, syncLeaseExpiresAt: { gt: now },
    },
    // This no-op token update takes the source row lock only for the final,
    // short commit window. Heartbeats remain free to renew throughout the
    // product work, while a claimant cannot replace the lease after this fence.
    data: { syncLeaseId: lease.id },
  });
  if (fenced.count !== 1) throw new CatalogueImportLeaseLostError();
}

async function catalogueWriteRetry(prisma: PrismaClient, operation: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await prisma.$transaction(operation, {
        // The final source fence must observe heartbeat renewals committed
        // after this long transaction began. Tenant advisory locking provides
        // the catalogue-writer serialization previously supplied by SSI.
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10_000,
        timeout: 10 * 60_000,
      });
      return;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt === 2) throw error;
    }
  }
}

function productCreate(tenantId: string, sourceId: string, row: { rowNumber: number; product: CatalogueImportProduct }): Prisma.ProductUncheckedCreateInput {
  const product = row.product;
  return {
    tenantId, sourceId, sourceRowKey: String(row.rowNumber), sku: product.sku, name: product.name,
    description: product.description ?? null, price: product.price ?? null, currency: product.currency ?? null, stockQuantity: product.stockQuantity ?? null,
    category: product.category ?? null, brand: product.brand ?? null, aliases: product.aliases, color: product.color ?? null, size: product.size ?? null,
    imageUrls: product.imageUrls, attributes: product.attributes as Prisma.InputJsonValue, active: product.active, sourceUpdatedAt: new Date(),
  };
}

function productUpdate(sourceId: string, row: { rowNumber: number; product: CatalogueImportProduct; presentTargets: ReadonlySet<string> }): Prisma.ProductUncheckedUpdateInput {
  const update: Prisma.ProductUncheckedUpdateInput = {
    sourceId, sourceRowKey: String(row.rowNumber), sku: row.product.sku, name: row.product.name, sourceUpdatedAt: new Date(),
  };
  for (const target of row.presentTargets) {
    if (target === 'sku' || target === 'name' || target === 'ignore') continue;
    if (target === 'attributes') update.attributes = row.product.attributes as Prisma.InputJsonValue;
    else update[target as keyof Prisma.ProductUncheckedUpdateInput] = row.product[target as keyof CatalogueImportProduct] as never;
  }
  return update;
}

function mapRow(values: CatalogueCell[], rowNumber: number, sourceId: string, indexes: Map<string, number>, mapping: CatalogueColumn[], clearFields: Set<CatalogueTarget>): CatalogueImportPlanRow {
  const presentTargets = new Set<CatalogueTarget>();
  const mapped = new Map<CatalogueTarget, CatalogueCell | undefined>();
  for (const column of mapping) if (column.target !== 'ignore') mapped.set(column.target, values[indexes.get(column.source) ?? -1]);
  if ([...mapped.values()].every((value) => value === null || value === undefined || value === '')) return { rowNumber, errors: [], codes: ['EMPTY_ROW'], presentTargets };
  const errors: string[] = [];
  const codes: string[] = [];
  const name = textValue(mapped.get('name'));
  if (!name) { errors.push('Name is required'); codes.push('NAME_REQUIRED'); }
  const hasSkuMapping = mapping.some((column) => column.target === 'sku');
  const suppliedSku = textValue(mapped.get('sku'))?.toUpperCase();
  if (hasSkuMapping && !suppliedSku) { errors.push('SKU is required'); codes.push('SKU_REQUIRED'); }
  const sku = suppliedSku ?? (!hasSkuMapping && name ? generatedSku(sourceId, name) : undefined);
  const product: CatalogueImportProduct = { sku: sku ?? '', name: name ?? '', aliases: [], imageUrls: [], attributes: {}, active: true };
  applyExplicitClears(product, presentTargets, mapped, clearFields);
  for (const target of ['description', 'category', 'brand', 'color', 'size'] as const) assignText(product, presentTargets, mapped, target);
  const currency = textValue(mapped.get('currency'));
  if (currency) { product.currency = currency.toUpperCase(); presentTargets.add('currency'); }
  if (nonEmpty(mapped.get('price'))) {
    const price = parseLocaleNumber(mapped.get('price'));
    if (price === null || price < 0) { errors.push('Price must be a non-negative number'); codes.push('PRICE_INVALID'); }
    else { product.price = price; presentTargets.add('price'); }
  }
  if (nonEmpty(mapped.get('stockQuantity'))) {
    const stock = parseLocaleNumber(mapped.get('stockQuantity'));
    if (stock === null || !Number.isInteger(stock)) { errors.push('Stock quantity must be an integer'); codes.push('STOCK_INVALID'); }
    else { product.stockQuantity = stock; presentTargets.add('stockQuantity'); }
  }
  if (nonEmpty(mapped.get('aliases'))) { product.aliases = splitList(mapped.get('aliases')); presentTargets.add('aliases'); }
  if (nonEmpty(mapped.get('imageUrls'))) {
    const urls = splitList(mapped.get('imageUrls'));
    if (urls.some((url) => !isHttpUrl(url))) { errors.push('Image URLs must be valid HTTP URLs'); codes.push('IMAGE_URLS_INVALID'); }
    else { product.imageUrls = urls; presentTargets.add('imageUrls'); }
  }
  if (nonEmpty(mapped.get('active'))) {
    const active = parseBoolean(mapped.get('active'));
    if (active === null) { errors.push('Active must be a boolean'); codes.push('ACTIVE_INVALID'); }
    else { product.active = active; presentTargets.add('active'); }
  }
  if (nonEmpty(mapped.get('attributes'))) {
    const attributes = parseAttributes(mapped.get('attributes'));
    if (!attributes) { errors.push('Attributes must be a JSON object'); codes.push('ATTRIBUTES_INVALID'); }
    else { product.attributes = attributes; presentTargets.add('attributes'); }
  }
  return errors.length > 0 ? { rowNumber, errors, codes, presentTargets } : { rowNumber, product, errors, codes, presentTargets };
}

function generatedSku(sourceId: string, name: string): string {
  const identity = `${sourceId}\0${name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')}`;
  return `AUTO-${createHash('sha256').update(identity).digest('hex').slice(0, 12).toUpperCase()}`;
}

function applyExplicitClears(product: CatalogueImportProduct, present: Set<CatalogueTarget>, mapped: Map<CatalogueTarget, CatalogueCell | undefined>, clearFields: Set<CatalogueTarget>) {
  for (const target of clearFields) {
    if (nonEmpty(mapped.get(target))) continue;
    present.add(target);
    if (target === 'aliases') product.aliases = [];
    else if (target === 'imageUrls') product.imageUrls = [];
    else if (target === 'attributes') product.attributes = {};
    else if (target !== 'sku' && target !== 'name' && target !== 'active' && target !== 'ignore') product[target] = null as never;
  }
}

function assignText(product: CatalogueImportProduct, present: Set<CatalogueTarget>, mapped: Map<CatalogueTarget, CatalogueCell | undefined>, target: 'description' | 'category' | 'brand' | 'color' | 'size') {
  const value = textValue(mapped.get(target));
  if (value !== undefined) { product[target] = value; present.add(target); }
}

function readClearFields(value: unknown): Set<CatalogueTarget> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return new Set();
  const fields = (value as { clearEmptyFields?: unknown }).clearEmptyFields;
  return new Set(Array.isArray(fields) ? fields.filter((field): field is CatalogueTarget => typeof field === 'string') : []);
}
function normalizeHeader(value: string) { return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'); }
function textValue(value: CatalogueCell | undefined) { const text = value === null || value === undefined ? '' : String(value).trim(); return text || undefined; }
function nonEmpty(value: CatalogueCell | undefined) { return textValue(value) !== undefined; }
function parseLocaleNumber(value: CatalogueCell | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = textValue(value); if (!text) return null;
  let normalized = text.replace(/[\s\u00a0]/g, ''); const comma = normalized.lastIndexOf(','); const dot = normalized.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) { const decimal = comma > dot ? ',' : '.'; normalized = normalized.replace(decimal === ',' ? /\./g : /,/g, '').replace(decimal, '.'); }
  else if (comma >= 0) normalized = normalized.replace(',', '.');
  if (!/^-?(?:\d+|\d*\.\d+)$/.test(normalized)) return null;
  const result = Number(normalized); return Number.isFinite(result) ? result : null;
}
function splitList(value: CatalogueCell | undefined) { const text = textValue(value); return text ? [...new Set(text.split(/[;,|\n]/).map((item) => item.trim()).filter(Boolean))] : []; }
function parseBoolean(value: CatalogueCell | undefined) { if (typeof value === 'boolean') return value; const normalized = textValue(value)?.toLowerCase(); return ['true', '1', 'yes'].includes(normalized ?? '') ? true : ['false', '0', 'no'].includes(normalized ?? '') ? false : null; }
function parseAttributes(value: CatalogueCell | undefined): Record<string, unknown> | null { try { const parsed = JSON.parse(textValue(value) ?? ''); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null; } catch { return null; } }
function isHttpUrl(value: string) { try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:'; } catch { return false; } }

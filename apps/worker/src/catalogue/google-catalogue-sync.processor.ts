import type { CatalogueTargetField } from '@autosale/contracts';
import { upsertCatalogueProducts, type CatalogueUpsertProduct, type CatalogueUpsertRow, type PrismaClient } from '@autosale/database';
import { GoogleSheetsReadError, googleSheetsStructureFingerprint, type GoogleSheetsAdapter, type GoogleSheetsCell } from '@autosale/integrations';

type MappingColumn = { source: string; target: CatalogueTargetField };
type ImportCounts = {
  totalRows: number; validRows: number; createdRows: number; updatedRows: number; skippedRows: number; failedRows: number;
  rowErrors: Array<{ rowNumber: number; errors: string[] }>;
};
type TableImporter = { importTable(input: {
  tenantId: string; sourceId: string; headers: string[]; rows: GoogleSheetsCell[][]; mapping: MappingColumn[]; transformSettings: unknown;
}): Promise<ImportCounts> };

export class GoogleCatalogueSyncProcessor {
  private readonly importer: TableImporter;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly sheets: Pick<GoogleSheetsAdapter, 'readTable'>,
    importer?: TableImporter,
  ) {
    this.importer = importer ?? new GoogleCatalogueTableImporter(prisma);
  }

  async process(input: { tenantId: string; sourceId: string }) {
    const source = await this.prisma.catalogueSource.findFirst({
      where: { id: input.sourceId, tenantId: input.tenantId, type: 'GOOGLE_SHEETS' },
      select: { id: true, spreadsheetId: true, sheetName: true },
    });
    if (!source?.spreadsheetId || !source.sheetName) throw new Error('Google catalogue source is unavailable');

    let table: Awaited<ReturnType<GoogleSheetsAdapter['readTable']>>;
    try {
      table = await this.sheets.readTable({ spreadsheetId: source.spreadsheetId, sheetName: source.sheetName, maxRows: 5_000 });
    } catch (error) {
      const failure = error instanceof GoogleSheetsReadError ? error : new GoogleSheetsReadError('RETRYABLE', true);
      await this.prisma.catalogueSource.updateMany({
        where: { id: input.sourceId, tenantId: input.tenantId, type: 'GOOGLE_SHEETS' },
        data: { status: failure.code === 'AUTHORIZATION' ? 'DISCONNECTED' : 'ERROR', lastErrorSummary: failure.code },
      });
      throw failure;
    }

    const idempotencyKey = `google:${input.sourceId}:${table.revision}`;
    const existing = await this.prisma.catalogueImportRun.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey } },
      select: { id: true, status: true },
    });
    if (existing) return { status: existing.status === 'COMPLETED' ? 'NOOP' as const : existing.status, revision: table.revision };

    const fingerprint = googleSheetsStructureFingerprint(table.headers);
    const mapping = await this.prisma.catalogueMapping.findFirst({
      where: { tenantId: input.tenantId, sourceId: input.sourceId, confirmedAt: { not: null } },
      orderBy: { version: 'desc' },
      select: { id: true, sourceFingerprint: true, columns: true, transformSettings: true },
    });
    const columns = readMapping(mapping?.columns);
    if (!mapping || mapping.sourceFingerprint !== fingerprint) {
      return this.pauseForReview(input, table, idempotencyKey, fingerprint, 'STRUCTURE_CHANGED');
    }
    if (!hasRequiredMapping(columns, table.headers)) {
      return this.pauseForReview(input, table, idempotencyKey, fingerprint, 'MISSING_REQUIRED_COLUMNS');
    }

    const sourceSkus = mappedSkus(table.headers, table.rows, columns);
    if (sourceSkus.duplicates.size > 0) return this.failWithoutMutation(input, table, mapping.id, idempotencyKey, fingerprint, 'SKU_COLLISION');
    const existingProducts = sourceSkus.values.length === 0 ? [] : await this.prisma.product.findMany({
      where: { tenantId: input.tenantId, sku: { in: sourceSkus.values } }, select: { sku: true, sourceId: true },
    });
    if (existingProducts.some((product) => product.sourceId !== input.sourceId)) {
      return this.failWithoutMutation(input, table, mapping.id, idempotencyKey, fingerprint, 'SKU_COLLISION');
    }

    const run = await this.prisma.catalogueImportRun.create({ data: {
      tenantId: input.tenantId,
      sourceId: input.sourceId,
      mappingId: mapping.id,
      status: 'PROCESSING',
      idempotencyKey,
      sourceRevision: table.revision,
      totalRows: table.rows.length,
      startedAt: new Date(),
    } });
    try {
      const result = await this.importer.importTable({
        tenantId: input.tenantId, sourceId: input.sourceId, headers: table.headers, rows: table.rows,
        mapping: columns, transformSettings: mapping.transformSettings,
      });
      await this.prisma.catalogueImportRun.updateMany({
        where: { id: run.id, tenantId: input.tenantId, status: 'PROCESSING' },
        data: { status: 'COMPLETED', ...result, rowErrors: result.rowErrors, completedAt: new Date() },
      });
      await this.prisma.catalogueSource.updateMany({
        where: { id: input.sourceId, tenantId: input.tenantId, type: 'GOOGLE_SHEETS' },
        data: { status: 'ACTIVE', headerFingerprint: fingerprint, lastSyncedAt: new Date(), lastErrorSummary: null },
      });
      return { status: 'COMPLETED' as const, revision: table.revision, ...result };
    } catch {
      await this.prisma.catalogueImportRun.updateMany({
        where: { id: run.id, tenantId: input.tenantId, status: 'PROCESSING' },
        data: { status: 'FAILED', rowErrors: [{ errors: ['IMPORT_FAILED'] }], completedAt: new Date() },
      });
      await this.prisma.catalogueSource.updateMany({
        where: { id: input.sourceId, tenantId: input.tenantId, type: 'GOOGLE_SHEETS' },
        data: { status: 'ERROR', lastErrorSummary: 'IMPORT_FAILED' },
      });
      throw new Error('Catalogue synchronization failed');
    }
  }

  private async pauseForReview(
    input: { tenantId: string; sourceId: string }, table: { rows: unknown[][]; revision: string }, idempotencyKey: string,
    fingerprint: string, reason: 'STRUCTURE_CHANGED' | 'MISSING_REQUIRED_COLUMNS',
  ) {
    await this.prisma.catalogueImportRun.create({ data: {
      tenantId: input.tenantId, sourceId: input.sourceId, mappingId: null, status: 'MAPPING_REVIEW', idempotencyKey,
      sourceRevision: table.revision, totalRows: table.rows.length, rowErrors: [{ errors: [reason] }], completedAt: new Date(),
    } });
    await this.prisma.catalogueSource.updateMany({
      where: { id: input.sourceId, tenantId: input.tenantId, type: 'GOOGLE_SHEETS' },
      data: { status: 'PAUSED', headerFingerprint: fingerprint, lastErrorSummary: reason },
    });
    return { status: 'MAPPING_REVIEW' as const, revision: table.revision, reason };
  }

  private async failWithoutMutation(
    input: { tenantId: string; sourceId: string }, table: { rows: unknown[][]; revision: string }, mappingId: string,
    idempotencyKey: string, fingerprint: string, reason: 'SKU_COLLISION',
  ) {
    await this.prisma.catalogueImportRun.create({ data: {
      tenantId: input.tenantId, sourceId: input.sourceId, mappingId, status: 'FAILED', idempotencyKey,
      sourceRevision: table.revision, totalRows: table.rows.length, failedRows: table.rows.length,
      rowErrors: [{ errors: [reason] }], completedAt: new Date(),
    } });
    await this.prisma.catalogueSource.updateMany({
      where: { id: input.sourceId, tenantId: input.tenantId, type: 'GOOGLE_SHEETS' },
      data: { status: 'PAUSED', headerFingerprint: fingerprint, lastErrorSummary: reason },
    });
    return { status: 'FAILED' as const, revision: table.revision, reason };
  }
}

class GoogleCatalogueTableImporter implements TableImporter {
  constructor(private readonly prisma: PrismaClient) {}

  async importTable(input: { tenantId: string; sourceId: string; headers: string[]; rows: GoogleSheetsCell[][]; mapping: MappingColumn[]; transformSettings: unknown }): Promise<ImportCounts> {
    const headerIndex = new Map(input.headers.map((header, index) => [normalizeHeader(header), index]));
    const rows = input.rows.map((values, index) => mapProductRow(values, index + 2, headerIndex, input.mapping));
    const valid: CatalogueUpsertRow[] = rows.flatMap((row) => row.product && row.errors.length === 0
      ? [{ rowNumber: row.rowNumber, product: row.product, presentTargets: row.presentTargets }]
      : []);
    const existing = valid.length === 0 ? [] : await this.prisma.product.findMany({
      where: { tenantId: input.tenantId, sku: { in: valid.map((row) => row.product.sku) } }, select: { sku: true },
    });
    const existingSkus = new Set(existing.map((product) => product.sku));
    await upsertCatalogueProducts(this.prisma, { tenantId: input.tenantId, sourceId: input.sourceId, rows: valid });
    return {
      totalRows: rows.length,
      validRows: valid.length,
      createdRows: valid.filter((row) => !existingSkus.has(row.product.sku)).length,
      updatedRows: valid.filter((row) => existingSkus.has(row.product.sku)).length,
      skippedRows: 0,
      failedRows: rows.length - valid.length,
      rowErrors: rows.filter((row) => row.errors.length > 0).slice(0, 100).map((row) => ({ rowNumber: row.rowNumber, errors: row.errors })),
    };
  }
}

function readMapping(value: unknown): MappingColumn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => item && typeof item === 'object' && !Array.isArray(item)
    && typeof (item as Record<string, unknown>).source === 'string' && typeof (item as Record<string, unknown>).target === 'string'
    ? [{ source: normalizeHeader((item as Record<string, unknown>).source as string), target: (item as Record<string, unknown>).target as CatalogueTargetField }]
    : []);
}

function hasRequiredMapping(mapping: MappingColumn[], headers: string[]): boolean {
  const available = new Set(headers.map(normalizeHeader));
  return ['sku', 'name'].every((target) => mapping.some((column) => column.target === target && available.has(column.source)));
}

function mappedSkus(headers: string[], rows: GoogleSheetsCell[][], mapping: MappingColumn[]) {
  const normalized = headers.map(normalizeHeader);
  const skuSource = mapping.find((column) => column.target === 'sku')?.source;
  const index = skuSource ? normalized.indexOf(skuSource) : -1;
  const values = index < 0 ? [] : rows.map((row) => text(row[index])?.toUpperCase()).filter((value): value is string => Boolean(value));
  const seen = new Set<string>(); const duplicates = new Set<string>();
  for (const value of values) { if (seen.has(value)) duplicates.add(value); else seen.add(value); }
  return { values: [...seen], duplicates };
}

function mapProductRow(values: GoogleSheetsCell[], rowNumber: number, indexes: Map<string, number>, mapping: MappingColumn[]) {
  const mapped = new Map<CatalogueTargetField, GoogleSheetsCell | undefined>();
  for (const column of mapping) mapped.set(column.target, values[indexes.get(column.source) ?? -1]);
  const sku = text(mapped.get('sku'))?.toUpperCase();
  const name = text(mapped.get('name'));
  const errors: string[] = [];
  if (!sku) errors.push('SKU_REQUIRED');
  if (!name) errors.push('NAME_REQUIRED');
  if (!sku || !name) return { rowNumber, errors, presentTargets: new Set<string>() };
  const product: CatalogueUpsertProduct = { sku, name, aliases: [], imageUrls: [], attributes: {}, active: true };
  const presentTargets = new Set<string>(['sku', 'name']);
  for (const [target, value] of mapped) {
    if (target === 'sku' || target === 'name' || target === 'ignore' || value === null || value === undefined || value === '') continue;
    presentTargets.add(target);
    if (target === 'aliases' || target === 'imageUrls') product[target] = split(value);
    else if (target === 'price') product.price = number(value);
    else if (target === 'stockQuantity') product.stockQuantity = Math.trunc(number(value) ?? 0);
    else if (target === 'active') product.active = ['true', '1', 'yes'].includes(String(value).toLowerCase());
    else if (target === 'attributes') product.attributes = jsonObject(value);
    else product[target] = text(value) as never;
  }
  return { rowNumber, product, errors, presentTargets };
}

function normalizeHeader(value: string) { return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'); }
function text(value: unknown) { const result = value === null || value === undefined ? '' : String(value).trim(); return result || undefined; }
function split(value: unknown) { return [...new Set(String(value).split(/[;,|\n]/).map((part) => part.trim()).filter(Boolean))]; }
function number(value: unknown) { const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.')); return Number.isFinite(parsed) ? parsed : null; }
function jsonObject(value: unknown) { try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }

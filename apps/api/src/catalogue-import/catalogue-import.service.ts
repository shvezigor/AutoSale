import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';

import type { CatalogueImportSummary, CataloguePreview, CatalogueTargetField } from '@autosale/contracts';
import { Prisma, type PrismaClient } from '@autosale/database';
import type { ObjectStorage } from '@autosale/integrations';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { parseCatalogueSource, type ParsedCell, type ParsedTable } from './source-parser.js';

export const MAX_CATALOGUE_UPLOAD_BYTES = 5 * 1024 * 1024;
const IMPORT_BATCH_SIZE = 100;
const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const supportedFiles = new Map([
  ['.csv', { mediaTypes: new Set(['text/csv', 'application/csv']), sourceType: 'CSV_UPLOAD' as const }],
  ['.xlsx', { mediaTypes: new Set([XLSX_MEDIA_TYPE]), sourceType: 'XLSX_UPLOAD' as const }],
]);

export type CatalogueUploadFile = {
  originalName: string;
  mediaType: string;
  buffer: Buffer;
};

export type CatalogueColumnMapping = {
  source: string;
  target: CatalogueTargetField;
  confidence?: number | undefined;
};

export type CatalogueMappingInput = {
  columns: CatalogueColumnMapping[];
  clearEmptyFields?: CatalogueTargetField[] | undefined;
};

export type CatalogueUploadResult = CatalogueImportSummary & {
  headers: string[];
  fingerprint: string;
};

type PreviewProduct = NonNullable<CataloguePreview['rows'][number]['product']>;
type InternalPreviewRow = CataloguePreview['rows'][number] & {
  codes: string[];
  presentTargets: Set<CatalogueTargetField>;
};

export class CatalogueImportService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: ObjectStorage,
  ) {}

  async upload(tenantId: string, userId: string, file: CatalogueUploadFile): Promise<CatalogueUploadResult> {
    const fileName = basename(file.originalName);
    if (fileName !== file.originalName || file.buffer.length === 0 || file.buffer.length > MAX_CATALOGUE_UPLOAD_BYTES) {
      throw new BadRequestException('Invalid catalogue upload');
    }
    const extension = extname(fileName).toLowerCase();
    const fileType = supportedFiles.get(extension);
    if (!fileType?.mediaTypes.has(file.mediaType)) throw new BadRequestException('Unsupported catalogue upload');

    let table: ParsedTable;
    try {
      table = await parseCatalogueSource(file.buffer, file.mediaType);
    } catch {
      throw new BadRequestException('Invalid catalogue source');
    }
    const sourceRevision = createHash('sha256').update(file.buffer).digest('hex');
    const objectKey = `catalogue/${tenantId}/${sourceRevision}${extension}`;
    await this.storage.put({ key: objectKey, body: file.buffer, contentType: file.mediaType });

    const existing = await this.prisma.catalogueImportRun.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: `upload:${sourceRevision}` } },
      include: { source: { select: { headerFingerprint: true, objectKey: true } } },
    });
    if (existing) {
      return { ...mapSummary(existing), headers: table.headers, fingerprint: existing.source.headerFingerprint ?? table.fingerprint };
    }

    const run = await this.prisma.$transaction(async (tx) => {
      const source = await tx.catalogueSource.create({
        data: {
          tenantId,
          type: fileType.sourceType,
          displayName: fileName,
          status: 'PENDING',
          createdByUserId: userId,
          objectKey,
          headerFingerprint: table.fingerprint,
        },
      });
      return tx.catalogueImportRun.create({
        data: {
          tenantId,
          sourceId: source.id,
          requestedByUserId: userId,
          status: 'UPLOADED',
          idempotencyKey: `upload:${sourceRevision}`,
          sourceRevision,
          totalRows: table.rows.length,
        },
      });
    });
    return { ...mapSummary(run), headers: table.headers, fingerprint: table.fingerprint };
  }

  async updateMapping(tenantId: string, userId: string, runId: string, input: CatalogueMappingInput): Promise<CataloguePreview> {
    const run = await this.loadRun(tenantId, runId);
    const table = await this.loadTable(run.source.objectKey, run.source.type);
    const columns = validateMapping(input.columns, table.headers);
    const clearEmptyFields = validateClearFields(input.clearEmptyFields ?? [], columns);
    const latest = await this.prisma.catalogueMapping.findFirst({
      where: { tenantId, sourceId: run.sourceId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const mapping = await this.prisma.catalogueMapping.create({
      data: {
        tenantId,
        sourceId: run.sourceId,
        version: (latest?.version ?? 0) + 1,
        sourceFingerprint: table.fingerprint,
        columns: columns as unknown as Prisma.InputJsonValue,
        transformSettings: { clearEmptyFields },
        ownerModified: true,
        confirmedAt: new Date(),
        confirmedByUserId: userId,
      },
    });
    await this.prisma.catalogueImportRun.updateMany({
      where: { id: runId, tenantId, status: { in: ['UPLOADED', 'MAPPING', 'MAPPING_REVIEW', 'PREVIEW_READY'] } },
      data: { mappingId: mapping.id, status: 'PREVIEW_READY' },
    });
    const preview = await this.preview(tenantId, runId);
    await this.prisma.catalogueImportRun.updateMany({
      where: { id: runId, tenantId },
      data: {
        totalRows: preview.rows.length,
        validRows: preview.totals.created + preview.totals.updated,
        skippedRows: preview.totals.skipped,
        failedRows: preview.totals.failed,
      },
    });
    return preview;
  }

  async preview(tenantId: string, runId: string): Promise<CataloguePreview> {
    const run = await this.loadRun(tenantId, runId);
    if (!run.mapping) throw new ConflictException('Catalogue mapping is not confirmed');
    const table = await this.loadTable(run.source.objectKey, run.source.type);
    if (table.fingerprint !== run.mapping.sourceFingerprint) throw new ConflictException('Catalogue headers changed');
    const mapping = readMapping(run.mapping.columns);
    const preview = await this.buildPreview(tenantId, table, mapping, readClearFields(run.mapping.transformSettings));
    return publicPreview(preview);
  }

  async confirm(tenantId: string, userId: string, runId: string): Promise<CatalogueImportSummary> {
    const lock = await this.prisma.catalogueImportRun.updateMany({
      where: { id: runId, tenantId, status: 'PREVIEW_READY' },
      data: { status: 'PROCESSING', requestedByUserId: userId, startedAt: new Date() },
    });
    if (lock.count !== 1) {
      const existing = await this.prisma.catalogueImportRun.findFirst({ where: { id: runId, tenantId } });
      if (!existing) throw new NotFoundException('Catalogue import not found');
      if (existing.status === 'COMPLETED') return mapSummary(existing);
      throw new ConflictException('Catalogue import cannot be confirmed');
    }

    try {
      const run = await this.loadRun(tenantId, runId);
      if (!run.mapping) throw new ConflictException('Catalogue mapping is not confirmed');
      const table = await this.loadTable(run.source.objectKey, run.source.type);
      if (table.fingerprint !== run.mapping.sourceFingerprint) throw new ConflictException('Catalogue headers changed');
      const internal = await this.buildPreview(tenantId, table, readMapping(run.mapping.columns), readClearFields(run.mapping.transformSettings));
      const validRows = internal.rows.filter((row): row is InternalPreviewRow & { product: PreviewProduct } => Boolean(row.product) && row.errors.length === 0);

      for (let offset = 0; offset < validRows.length; offset += IMPORT_BATCH_SIZE) {
        const batch = validRows.slice(offset, offset + IMPORT_BATCH_SIZE);
        await this.prisma.$transaction(batch.map((row) => this.prisma.product.upsert({
          where: { tenantId_sku: { tenantId, sku: row.product.sku } },
          create: productCreate(tenantId, run.sourceId, row),
          update: productUpdate(run.sourceId, row),
        })));
      }

      const completed = await this.prisma.catalogueImportRun.update({
        where: { id: runId },
        data: {
          status: 'COMPLETED',
          totalRows: internal.rows.length,
          validRows: validRows.length,
          createdRows: internal.totals.created,
          updatedRows: internal.totals.updated,
          skippedRows: internal.totals.skipped,
          failedRows: internal.totals.failed,
          rowErrors: internal.rows
            .filter((row) => row.codes.length > 0)
            .slice(0, 100)
            .map((row) => ({ rowNumber: row.rowNumber, errors: row.codes })) as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      return mapSummary(completed);
    } catch (error) {
      await this.prisma.catalogueImportRun.updateMany({
        where: { id: runId, tenantId, status: 'PROCESSING' },
        data: { status: 'FAILED', rowErrors: [{ errors: ['IMPORT_FAILED'] }], completedAt: new Date() },
      });
      throw error;
    }
  }

  private async buildPreview(tenantId: string, table: ParsedTable, mapping: CatalogueColumnMapping[], clearEmptyFields: Set<CatalogueTargetField>): Promise<{ rows: InternalPreviewRow[]; totals: CataloguePreview['totals'] }> {
    const rows = table.rows.map((sourceRow, index) => mapRow(sourceRow, mapping, clearEmptyFields, index + 2));
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
    const existing = validSkus.length === 0 ? [] : await this.prisma.product.findMany({
      where: { tenantId, sku: { in: validSkus } },
      select: { sku: true },
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

  private async loadRun(tenantId: string, runId: string) {
    const run = await this.prisma.catalogueImportRun.findFirst({
      where: { id: runId, tenantId },
      include: {
        source: { select: { type: true, objectKey: true } },
        mapping: { select: { sourceFingerprint: true, columns: true, transformSettings: true } },
      },
    });
    if (!run) throw new NotFoundException('Catalogue import not found');
    return run;
  }

  private async loadTable(objectKey: string | null, sourceType: 'CSV_UPLOAD' | 'XLSX_UPLOAD' | 'GOOGLE_SHEETS'): Promise<ParsedTable> {
    if (!objectKey || sourceType === 'GOOGLE_SHEETS') throw new ConflictException('Catalogue source file is unavailable');
    const object = await this.storage.get(objectKey);
    return parseCatalogueSource(Buffer.from(object.body), object.contentType);
  }
}

function validateMapping(columns: CatalogueColumnMapping[], headers: string[]): CatalogueColumnMapping[] {
  if (columns.length === 0) throw new BadRequestException('Catalogue mapping is empty');
  const normalized = columns.map((column) => ({ ...column, source: column.source.trim().toLocaleLowerCase('en-US') }));
  if (new Set(normalized.map((column) => column.source)).size !== normalized.length) throw new BadRequestException('Mapped source columns must be unique');
  if (normalized.some((column) => !headers.includes(column.source))) throw new BadRequestException('Mapped source column is missing');
  const targets = normalized.filter((column) => column.target !== 'ignore').map((column) => column.target);
  if (new Set(targets).size !== targets.length || !targets.includes('sku') || !targets.includes('name')) {
    throw new BadRequestException('SKU and name mappings are required and targets must be unique');
  }
  return normalized;
}

function validateClearFields(clearFields: CatalogueTargetField[], columns: CatalogueColumnMapping[]): CatalogueTargetField[] {
  const clearable = new Set<CatalogueTargetField>([
    'description', 'price', 'currency', 'stockQuantity', 'category', 'brand', 'aliases', 'color', 'size', 'imageUrls', 'attributes',
  ]);
  const mapped = new Set(columns.map((column) => column.target));
  if (new Set(clearFields).size !== clearFields.length || clearFields.some((field) => !clearable.has(field) || !mapped.has(field))) {
    throw new BadRequestException('Clear fields must be unique, clearable mapped targets');
  }
  return clearFields;
}

function readMapping(value: Prisma.JsonValue): CatalogueColumnMapping[] {
  if (!Array.isArray(value)) throw new ConflictException('Catalogue mapping is invalid');
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.source !== 'string' || typeof item.target !== 'string') {
      throw new ConflictException('Catalogue mapping is invalid');
    }
    return { source: item.source, target: item.target as CatalogueTargetField };
  });
}

function readClearFields(value: Prisma.JsonValue | null): Set<CatalogueTargetField> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.clearEmptyFields)) return new Set();
  return new Set(value.clearEmptyFields.filter((field): field is CatalogueTargetField => typeof field === 'string') as CatalogueTargetField[]);
}

function mapRow(sourceRow: Record<string, ParsedCell>, mapping: CatalogueColumnMapping[], clearEmptyFields: Set<CatalogueTargetField>, rowNumber: number): InternalPreviewRow {
  const presentTargets = new Set<CatalogueTargetField>();
  const mapped = new Map<CatalogueTargetField, ParsedCell>();
  for (const column of mapping) {
    if (column.target !== 'ignore') mapped.set(column.target, sourceRow[column.source] ?? null);
  }
  if ([...mapped.values()].every((value) => value === null || value === '')) {
    return { rowNumber, errors: [], codes: ['EMPTY_ROW'], presentTargets };
  }

  const errors: string[] = [];
  const codes: string[] = [];
  const sku = textValue(mapped.get('sku'))?.toUpperCase();
  const name = textValue(mapped.get('name'));
  if (!sku) { errors.push('SKU is required'); codes.push('SKU_REQUIRED'); }
  if (!name) { errors.push('Name is required'); codes.push('NAME_REQUIRED'); }
  const product: PreviewProduct = { sku: sku ?? '', name: name ?? '', aliases: [], imageUrls: [], attributes: {}, active: true };
  applyExplicitClears(product, presentTargets, mapped, clearEmptyFields);

  assignText(product, presentTargets, mapped, 'description');
  assignText(product, presentTargets, mapped, 'category');
  assignText(product, presentTargets, mapped, 'brand');
  assignText(product, presentTargets, mapped, 'color');
  assignText(product, presentTargets, mapped, 'size');
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
  if (nonEmpty(mapped.get('aliases'))) {
    product.aliases = splitList(mapped.get('aliases'));
    presentTargets.add('aliases');
  }
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

function applyExplicitClears(product: PreviewProduct, present: Set<CatalogueTargetField>, mapped: Map<CatalogueTargetField, ParsedCell>, clearFields: Set<CatalogueTargetField>): void {
  for (const target of clearFields) {
    if (nonEmpty(mapped.get(target))) continue;
    present.add(target);
    if (target === 'aliases') product.aliases = [];
    else if (target === 'imageUrls') product.imageUrls = [];
    else if (target === 'attributes') product.attributes = {};
    else if (target === 'description' || target === 'price' || target === 'currency' || target === 'stockQuantity'
      || target === 'category' || target === 'brand' || target === 'color' || target === 'size') product[target] = null;
  }
}

function assignText(product: PreviewProduct, present: Set<CatalogueTargetField>, mapped: Map<CatalogueTargetField, ParsedCell>, target: 'description' | 'category' | 'brand' | 'color' | 'size'): void {
  const value = textValue(mapped.get(target));
  if (value !== undefined) { product[target] = value; present.add(target); }
}

function textValue(value: ParsedCell | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function nonEmpty(value: ParsedCell | undefined): boolean {
  return textValue(value) !== undefined;
}

function parseLocaleNumber(value: ParsedCell | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = textValue(value);
  if (!text) return null;
  let normalized = text.replace(/[\s\u00a0]/g, '');
  const comma = normalized.lastIndexOf(',');
  const dot = normalized.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.';
    normalized = normalized.replace(decimal === ',' ? /\./g : /,/g, '').replace(decimal, '.');
  } else if (comma >= 0) {
    normalized = normalized.replace(',', '.');
  }
  if (!/^-?(?:\d+|\d*\.\d+)$/.test(normalized)) return null;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function splitList(value: ParsedCell | undefined): string[] {
  const text = textValue(value);
  if (!text) return [];
  return [...new Set(text.split(/[;,|\n]/).map((item) => item.trim()).filter(Boolean))];
}

function parseBoolean(value: ParsedCell | undefined): boolean | null {
  if (typeof value === 'boolean') return value;
  const normalized = textValue(value)?.toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return null;
}

function parseAttributes(value: ParsedCell | undefined): Record<string, unknown> | null {
  const text = textValue(value);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function publicPreview(preview: { rows: InternalPreviewRow[]; totals: CataloguePreview['totals'] }): CataloguePreview {
  return {
    rows: preview.rows.map((row) => row.product
      ? { rowNumber: row.rowNumber, product: row.product, errors: row.errors }
      : { rowNumber: row.rowNumber, errors: row.errors }),
    totals: preview.totals,
  };
}

function productCreate(tenantId: string, sourceId: string, row: InternalPreviewRow & { product: PreviewProduct }): Prisma.ProductUncheckedCreateInput {
  const create: Prisma.ProductUncheckedCreateInput = {
    tenantId,
    sourceId,
    sourceRowKey: String(row.rowNumber),
    sku: row.product.sku,
    name: row.product.name,
    aliases: row.product.aliases,
    imageUrls: row.product.imageUrls,
    attributes: row.product.attributes as Prisma.InputJsonValue,
    active: row.product.active,
    sourceUpdatedAt: new Date(),
  };
  if (row.product.description !== undefined) create.description = row.product.description;
  if (row.product.price !== undefined) create.price = row.product.price;
  if (row.product.currency !== undefined) create.currency = row.product.currency;
  if (row.product.stockQuantity !== undefined) create.stockQuantity = row.product.stockQuantity;
  if (row.product.category !== undefined) create.category = row.product.category;
  if (row.product.brand !== undefined) create.brand = row.product.brand;
  if (row.product.color !== undefined) create.color = row.product.color;
  if (row.product.size !== undefined) create.size = row.product.size;
  return create;
}

function productUpdate(sourceId: string, row: InternalPreviewRow & { product: PreviewProduct }): Prisma.ProductUncheckedUpdateInput {
  const update: Prisma.ProductUncheckedUpdateInput = {
    sourceId,
    sourceRowKey: String(row.rowNumber),
    sku: row.product.sku,
    name: row.product.name,
    sourceUpdatedAt: new Date(),
  };
  for (const target of row.presentTargets) {
    if (target === 'sku' || target === 'name' || target === 'ignore') continue;
    if (target === 'attributes') update.attributes = row.product.attributes as Prisma.InputJsonValue;
    else update[target] = row.product[target] as never;
  }
  return update;
}

function mapSummary(run: {
  id: string; sourceId: string; status: CatalogueImportSummary['status']; totalRows: number; validRows: number;
  createdRows: number; updatedRows: number; skippedRows: number; failedRows: number; startedAt: Date | null; completedAt: Date | null;
}): CatalogueImportSummary {
  return {
    id: run.id,
    sourceId: run.sourceId,
    status: run.status,
    totalRows: run.totalRows,
    validRows: run.validRows,
    createdRows: run.createdRows,
    updatedRows: run.updatedRows,
    skippedRows: run.skippedRows,
    failedRows: run.failedRows,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

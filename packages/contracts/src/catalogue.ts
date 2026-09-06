import { z } from 'zod';

export const catalogueTargetFieldSchema = z.enum([
  'sku', 'name', 'description', 'price', 'currency', 'stockQuantity',
  'category', 'brand', 'aliases', 'color', 'size', 'imageUrls', 'active', 'attributes', 'ignore',
]);

export const catalogueSourceTypeSchema = z.enum(['XLSX_UPLOAD', 'CSV_UPLOAD', 'GOOGLE_SHEETS']);
export const catalogueSourceStatusSchema = z.enum(['PENDING', 'ACTIVE', 'PAUSED', 'ERROR', 'DISCONNECTED']);
export const catalogueImportStatusSchema = z.enum([
  'UPLOADED', 'MAPPING', 'MAPPING_REVIEW', 'PREVIEW_READY', 'CONFIRMED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED',
]);
export const catalogueSyncScheduleSchema = z.enum(['MANUAL', 'HOURLY', 'DAILY']);

export const googleCatalogueSourceInputSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  spreadsheet: z.string().trim().min(5).max(500),
  sheetName: z.string().trim().min(1).max(200),
  syncSchedule: catalogueSyncScheduleSchema,
}).strict();

const nullableString = z.string().nullable().optional();

export const catalogueProductSchema = z.object({
  id: z.string().uuid().optional(),
  sku: z.string().min(1),
  name: z.string().min(1),
  description: nullableString,
  price: z.number().finite().nonnegative().nullable().optional(),
  currency: nullableString,
  stockQuantity: z.number().int().nullable().optional(),
  category: nullableString,
  brand: nullableString,
  aliases: z.array(z.string().min(1)).default([]),
  color: nullableString,
  size: nullableString,
  imageUrls: z.array(z.string().url()).default([]),
  attributes: z.record(z.string(), z.unknown()).default({}),
  active: z.boolean().default(true),
  sourceId: z.string().uuid().nullable().optional(),
  sourceRowKey: nullableString,
  sourceUpdatedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
}).strict();

export const catalogueMappingProposalSchema = z.object({
  columns: z.array(z.object({
    source: z.string().min(1),
    target: catalogueTargetFieldSchema,
    confidence: z.number().min(0).max(1),
  }).strict()),
}).strict();

export const rawCatalogueCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const rawCatalogueMatrixSchema = z.object({
  rows: z.array(z.object({
    rowNumber: z.number().int().positive(),
    cells: z.array(rawCatalogueCellSchema).max(500),
  }).strict()).max(5_000),
  revision: z.string().min(1),
}).strict();

const tableStructureProposalBaseSchema = z.object({
  headerStartRow: z.number().int().positive(),
  headerEndRow: z.number().int().positive(),
  dataStartRow: z.number().int().positive(),
  structureConfidence: z.number().min(0).max(1),
  columns: z.array(z.object({
    index: z.number().int().min(0).max(499),
    label: z.string().min(1).max(300),
    target: catalogueTargetFieldSchema,
    confidence: z.number().min(0).max(1),
  }).strict()).min(1).max(500),
}).strict();

function validateTableStructureRows(
  value: { headerStartRow: number; headerEndRow: number; dataStartRow: number },
  context: z.RefinementCtx,
) {
  if (value.headerEndRow < value.headerStartRow || value.headerEndRow - value.headerStartRow > 2) {
    context.addIssue({ code: 'custom', message: 'Header span must contain one to three rows' });
  }
  if (value.dataStartRow <= value.headerEndRow) {
    context.addIssue({ code: 'custom', message: 'Data must start after headers' });
  }
}

export const tableStructureProposalSchema = tableStructureProposalBaseSchema.superRefine(validateTableStructureRows);

export const ambiguousRowClassificationSchema = z.object({
  rowNumber: z.number().int().positive(),
  kind: z.enum(['PRODUCT', 'SKIP']),
  confidence: z.number().min(0).max(1),
}).strict();

export const catalogueStructurePlanSchema = tableStructureProposalBaseSchema.extend({
  version: z.literal(2),
  productRowNumbers: z.array(z.number().int().positive()).max(5_000),
  skippedRowNumbers: z.array(z.number().int().positive()).max(5_000),
  sourceRowNumbers: z.array(z.number().int().positive()).max(5_000),
  sourceRevision: z.string().min(1),
}).strict().superRefine(validateTableStructureRows);

export const catalogueSourceSummarySchema = z.object({
  id: z.string().uuid(),
  type: catalogueSourceTypeSchema,
  displayName: z.string().min(1),
  status: catalogueSourceStatusSchema,
  lastSyncedAt: z.string().datetime().nullable(),
  lastErrorSummary: z.string().nullable(),
  updatedAt: z.string().datetime(),
}).strict();

export const cataloguePreviewSchema = z.object({
  rows: z.array(z.object({
    rowNumber: z.number().int().positive(),
    product: catalogueProductSchema.optional(),
    errors: z.array(z.string().min(1)),
  }).strict()),
  totals: z.object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export const catalogueImportSummarySchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  status: catalogueImportStatusSchema,
  totalRows: z.number().int().nonnegative(),
  validRows: z.number().int().nonnegative(),
  createdRows: z.number().int().nonnegative(),
  updatedRows: z.number().int().nonnegative(),
  skippedRows: z.number().int().nonnegative(),
  failedRows: z.number().int().nonnegative(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
}).strict();

export type CatalogueTargetField = z.infer<typeof catalogueTargetFieldSchema>;
export type CatalogueSourceType = z.infer<typeof catalogueSourceTypeSchema>;
export type CatalogueSourceStatus = z.infer<typeof catalogueSourceStatusSchema>;
export type CatalogueImportStatus = z.infer<typeof catalogueImportStatusSchema>;
export type CatalogueSyncSchedule = z.infer<typeof catalogueSyncScheduleSchema>;
export type GoogleCatalogueSourceInput = z.infer<typeof googleCatalogueSourceInputSchema>;
export type CatalogueProduct = z.infer<typeof catalogueProductSchema>;
export type CatalogueSourceSummary = z.infer<typeof catalogueSourceSummarySchema>;
export type CatalogueMappingProposal = z.infer<typeof catalogueMappingProposalSchema>;
export type RawCatalogueCell = z.infer<typeof rawCatalogueCellSchema>;
export type RawCatalogueMatrix = z.infer<typeof rawCatalogueMatrixSchema>;
export type TableStructureProposal = z.infer<typeof tableStructureProposalSchema>;
export type AmbiguousRowClassification = z.infer<typeof ambiguousRowClassificationSchema>;
export type CatalogueStructurePlan = z.infer<typeof catalogueStructurePlanSchema>;
export type CataloguePreview = z.infer<typeof cataloguePreviewSchema>;
export type CatalogueImportSummary = z.infer<typeof catalogueImportSummarySchema>;

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
export type CatalogueProduct = z.infer<typeof catalogueProductSchema>;
export type CatalogueSourceSummary = z.infer<typeof catalogueSourceSummarySchema>;
export type CatalogueMappingProposal = z.infer<typeof catalogueMappingProposalSchema>;
export type CataloguePreview = z.infer<typeof cataloguePreviewSchema>;
export type CatalogueImportSummary = z.infer<typeof catalogueImportSummarySchema>;

import { describe, expect, it } from 'vitest';
import {
  ambiguousRowClassificationSchema,
  catalogueMappingProposalSchema,
  catalogueProductSchema,
  catalogueStructurePlanSchema,
  rawCatalogueMatrixSchema,
  tableStructureProposalSchema,
} from './catalogue.js';

describe('catalogue contracts', () => {
  it('accepts a typed product and rejects an invented mapping target', () => {
    expect(catalogueProductSchema.parse({ sku: 'LUNA-01', name: 'Luna', aliases: [], active: true }).sku).toBe('LUNA-01');
    expect(() => catalogueMappingProposalSchema.parse({ columns: [{ source: 'Назва', target: 'magic', confidence: 0.8 }] })).toThrow();
  });

  it('accepts indexed multi-row structure proposals and rejects invalid row spans', () => {
    const proposal = tableStructureProposalSchema.parse({
      headerStartRow: 21,
      headerEndRow: 22,
      dataStartRow: 23,
      structureConfidence: 0.97,
      columns: [
        { index: 5, label: 'Асортимент', target: 'name', confidence: 0.99 },
        { index: 7, label: 'Ціна (грн) / Роздріб', target: 'price', confidence: 0.98 },
      ],
    });

    expect(proposal.columns[0]?.index).toBe(5);
    expect(() => tableStructureProposalSchema.parse({ ...proposal, headerEndRow: 25 })).toThrow();
    expect(() => tableStructureProposalSchema.parse({ ...proposal, dataStartRow: 22 })).toThrow();
  });

  it('preserves raw coordinates and rejects rows or cells outside catalogue bounds', () => {
    expect(rawCatalogueMatrixSchema.parse({
      revision: 'revision-1',
      rows: [{ rowNumber: 4, cells: [null, 'Назва', 1200, true] }],
    }).rows[0]?.rowNumber).toBe(4);
    expect(() => rawCatalogueMatrixSchema.parse({ revision: 'revision-1', rows: [{ rowNumber: 0, cells: [] }] })).toThrow();
    expect(() => rawCatalogueMatrixSchema.parse({ revision: 'revision-1', rows: [{ rowNumber: 1, cells: Array(501).fill(null) }] })).toThrow();
  });

  it('accepts only row decisions that preserve a positive source row number', () => {
    expect(ambiguousRowClassificationSchema.parse({ rowNumber: 24, kind: 'PRODUCT', confidence: 0.96 }).kind).toBe('PRODUCT');
    expect(() => ambiguousRowClassificationSchema.parse({ rowNumber: 0, kind: 'PRODUCT', confidence: 0.96 })).toThrow();
  });

  it('requires a versioned structure plan with original source coordinates', () => {
    const plan = catalogueStructurePlanSchema.parse({
      version: 2,
      headerStartRow: 21,
      headerEndRow: 22,
      dataStartRow: 23,
      structureConfidence: 0.97,
      columns: [{ index: 5, label: 'Асортимент', target: 'name', confidence: 0.99 }],
      productRowNumbers: [24],
      skippedRowNumbers: [23],
      sourceRowNumbers: [24],
      sourceRevision: 'revision-1',
    });

    expect(plan.version).toBe(2);
    expect(plan.sourceRowNumbers).toEqual([24]);
  });
});

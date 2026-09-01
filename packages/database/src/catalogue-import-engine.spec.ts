import { describe, expect, it, vi } from 'vitest';

import { CatalogueImportLeaseLostError, CatalogueSkuOwnershipError, buildCatalogueImportPlan, importCatalogueTable } from './index.js';

const mapping = [
  { source: 'sku', target: 'sku' as const }, { source: 'name', target: 'name' as const },
  { source: 'price', target: 'price' as const }, { source: 'stock', target: 'stockQuantity' as const },
  { source: 'active', target: 'active' as const }, { source: 'aliases', target: 'aliases' as const },
  { source: 'images', target: 'imageUrls' as const }, { source: 'attributes', target: 'attributes' as const },
  { source: 'description', target: 'description' as const },
];

describe('catalogue table import engine', () => {
  it('uses the production normalization and validation semantics for every supported value type', async () => {
    const prisma = prismaDouble([{ sku: 'OLD', sourceId: 'source-1' }]);
    const plan = await buildCatalogueImportPlan(prisma as never, {
      tenantId: 'tenant-1', sourceId: 'source-1', mapping,
      transformSettings: { clearEmptyFields: ['description'] },
      headers: [' SKU ', 'Name', 'Price', 'Stock', 'Active', 'Aliases', 'Images', 'Attributes', 'Description'],
      rows: [
        ['', '', '', '', '', '', '', '', ''],
        ['new', 'New', '1 234,50', '7', 'no', 'alpha; beta;alpha', 'https://example.com/a.jpg', '{"material":"linen"}', ''],
        ['bad-price', 'Bad', 'free', '1.5', 'sometimes', 'x', 'javascript:alert(1)', '[]', 'kept'],
      ],
    });

    expect(plan.totals).toEqual({ created: 1, updated: 0, skipped: 1, failed: 1 });
    expect(plan.rows[0]).toMatchObject({ rowNumber: 2, codes: ['EMPTY_ROW'] });
    expect(plan.rows[1]?.product).toMatchObject({
      sku: 'NEW', name: 'New', price: 1234.5, stockQuantity: 7, active: false,
      aliases: ['alpha', 'beta'], imageUrls: ['https://example.com/a.jpg'], attributes: { material: 'linen' }, description: null,
    });
    expect([...plan.rows[1]!.presentTargets]).toContain('description');
    expect(plan.rows[2]?.codes).toEqual(expect.arrayContaining(['PRICE_INVALID', 'STOCK_INVALID', 'ACTIVE_INVALID', 'IMAGE_URLS_INVALID', 'ATTRIBUTES_INVALID']));
  });

  it('detects duplicate normalized SKUs and never upserts either row', async () => {
    const prisma = prismaDouble([]);
    const result = await importCatalogueTable(prisma as never, {
      tenantId: 'tenant-1', sourceId: 'source-1', mapping: mapping.slice(0, 2), transformSettings: null,
      headers: ['SKU', 'Name'], rows: [[' luna-1 ', 'One'], ['LUNA-1', 'Two']],
    });

    expect(result).toMatchObject({ validRows: 0, failedRows: 2 });
    expect(prisma.product.upsert).not.toHaveBeenCalled();
  });

  it('lets a changed file upload replace the tenant product and its source ownership', async () => {
    const prisma = prismaDouble([{ sku: 'LUNA-1', sourceId: 'old-upload' }]);

    await expect(importCatalogueTable(prisma as never, {
      tenantId: 'tenant-1', sourceId: 'new-upload', ownershipPolicy: 'REASSIGN', mapping: mapping.slice(0, 2), transformSettings: null,
      headers: ['SKU', 'Name'], rows: [['LUNA-1', 'Luna renamed by Task 7']],
    })).resolves.toMatchObject({ validRows: 1, updatedRows: 1 });
    expect(prisma.product.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ sourceId: 'new-upload', name: 'Luna renamed by Task 7' }),
    }));
  });

  it('fences a Google SKU owned by another source inside the upsert transaction', async () => {
    const prisma = prismaDouble([{ sku: 'LUNA-1', sourceId: 'source-2' }]);

    await expect(importCatalogueTable(prisma as never, {
      tenantId: 'tenant-1', sourceId: 'source-1', ownershipPolicy: 'FENCE_CROSS_SOURCE', mapping: mapping.slice(0, 2), transformSettings: null,
      headers: ['SKU', 'Name'], rows: [['LUNA-1', 'Luna']],
    })).rejects.toBeInstanceOf(CatalogueSkuOwnershipError);
    expect(prisma.product.upsert).not.toHaveBeenCalled();
  });

  it('validates every SKU collision before mutating any product', async () => {
    const prisma = prismaDouble([{ sku: 'SKU-101', sourceId: 'another-google-source' }]);
    const rows = Array.from({ length: 101 }, (_, index) => [`SKU-${index + 1}`, `Product ${index + 1}`]);

    await expect(importCatalogueTable(prisma as never, {
      tenantId: 'tenant-1', sourceId: 'google-source', ownershipPolicy: 'FENCE_CROSS_SOURCE', mapping: mapping.slice(0, 2), transformSettings: null,
      headers: ['SKU', 'Name'], rows,
    })).rejects.toBeInstanceOf(CatalogueSkuOwnershipError);
    expect(prisma.product.upsert).not.toHaveBeenCalled();
  });

  it('rolls back product mutation when the source lease fence is lost before commit', async () => {
    const prisma = prismaDouble([], { leaseCounts: [1, 0], transactionalWrites: true });

    await expect(importCatalogueTable(prisma as never, {
      tenantId: 'tenant-1', sourceId: 'google-source', ownershipPolicy: 'FENCE_CROSS_SOURCE', mapping: mapping.slice(0, 2), transformSettings: null,
      headers: ['SKU', 'Name'], rows: [['LUNA-1', 'Luna']],
      lease: { id: 'lease-1', syncVersion: 7, ttlMs: 300_000 },
    })).rejects.toBeInstanceOf(CatalogueImportLeaseLostError);
    expect(prisma.committedWrites).toEqual([]);
  });
});

function prismaDouble(
  existing: Array<{ sku: string; sourceId: string | null }>,
  options: { leaseCounts?: number[]; transactionalWrites?: boolean } = {},
) {
  const committedWrites: unknown[] = [];
  let pendingWrites: unknown[] = [];
  const product = {
    findMany: vi.fn().mockImplementation(({ where }) => Promise.resolve(existing.filter((row) => !where.sku?.in || where.sku.in.includes(row.sku)))),
    upsert: vi.fn().mockImplementation(async (args) => {
      (options.transactionalWrites ? pendingWrites : committedWrites).push(args);
      return {};
    }),
  };
  const catalogueSource = { updateMany: vi.fn().mockImplementation(async () => ({ count: options.leaseCounts?.shift() ?? 1 })) };
  return {
    committedWrites,
    product,
    catalogueSource,
    $transaction: vi.fn().mockImplementation(async (work) => {
      if (typeof work !== 'function') return Promise.all(work);
      pendingWrites = [];
      try {
        const result = await work({ product, catalogueSource });
        committedWrites.push(...pendingWrites);
        return result;
      } finally {
        pendingWrites = [];
      }
    }),
  };
}

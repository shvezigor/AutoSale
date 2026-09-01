import { Prisma, type PrismaClient } from './generated/prisma/client.js';

export { createPrismaClient } from './client.js';
export { Prisma, PrismaClient } from './generated/prisma/client.js';

export type CatalogueUpsertProduct = {
  sku: string; name: string; description?: string | null | undefined; price?: number | null | undefined; currency?: string | null | undefined;
  stockQuantity?: number | null | undefined; category?: string | null | undefined; brand?: string | null | undefined; aliases: string[];
  color?: string | null | undefined; size?: string | null | undefined; imageUrls: string[]; attributes: Record<string, unknown>; active: boolean;
};

export type CatalogueUpsertRow = { rowNumber: number; product: CatalogueUpsertProduct; presentTargets: ReadonlySet<string> };

export async function upsertCatalogueProducts(
  prisma: PrismaClient,
  input: { tenantId: string; sourceId: string; rows: CatalogueUpsertRow[]; batchSize?: number },
): Promise<void> {
  const batchSize = input.batchSize ?? 100;
  for (let offset = 0; offset < input.rows.length; offset += batchSize) {
    const batch = input.rows.slice(offset, offset + batchSize);
    await prisma.$transaction(batch.map((row) => prisma.product.upsert({
      where: { tenantId_sku: { tenantId: input.tenantId, sku: row.product.sku } },
      create: productCreate(input.tenantId, input.sourceId, row),
      update: productUpdate(input.sourceId, row),
    })));
  }
}

function productCreate(tenantId: string, sourceId: string, row: CatalogueUpsertRow): Prisma.ProductUncheckedCreateInput {
  const create: Prisma.ProductUncheckedCreateInput = {
    tenantId, sourceId, sourceRowKey: String(row.rowNumber), sku: row.product.sku, name: row.product.name,
    aliases: row.product.aliases, imageUrls: row.product.imageUrls, attributes: row.product.attributes as Prisma.InputJsonValue,
    active: row.product.active, sourceUpdatedAt: new Date(),
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

function productUpdate(sourceId: string, row: CatalogueUpsertRow): Prisma.ProductUncheckedUpdateInput {
  const update: Prisma.ProductUncheckedUpdateInput = {
    sourceId, sourceRowKey: String(row.rowNumber), sku: row.product.sku, name: row.product.name, sourceUpdatedAt: new Date(),
  };
  for (const target of row.presentTargets) {
    if (target === 'sku' || target === 'name' || target === 'ignore') continue;
    if (target === 'attributes') update.attributes = row.product.attributes as Prisma.InputJsonValue;
    else update[target as keyof Prisma.ProductUncheckedUpdateInput] = row.product[target as keyof CatalogueUpsertProduct] as never;
  }
  return update;
}

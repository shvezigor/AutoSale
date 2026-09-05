import type { CatalogueProduct } from '@autosale/contracts';
import { Prisma, type PrismaClient } from '@autosale/database';
import { ConflictException, NotFoundException } from '@nestjs/common';

export type CatalogueListQuery = {
  search?: string | undefined;
  page: number;
  pageSize: number;
};

export type CatalogueProductCreate = {
  sku: string;
  name: string;
  description?: string | null | undefined;
  price?: number | null | undefined;
  currency?: string | null | undefined;
  stockQuantity?: number | null | undefined;
  category?: string | null | undefined;
  brand?: string | null | undefined;
  aliases?: string[] | undefined;
  color?: string | null | undefined;
  size?: string | null | undefined;
  imageUrls?: string[] | undefined;
  attributes?: Record<string, unknown> | undefined;
  active?: boolean | undefined;
};

export type CatalogueProductUpdate = Partial<CatalogueProductCreate>;

export class CatalogueService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(tenantId: string, query: CatalogueListQuery): Promise<{ items: CatalogueProduct[]; page: number; pageSize: number; total: number }> {
    const search = query.search?.trim();
    const where: Prisma.ProductWhereInput = {
      tenantId,
      ...(search ? {
        OR: [
          { sku: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
          { aliases: { array_contains: [search] } },
        ],
      } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: [{ name: 'asc' }, { sku: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: productSelect,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items: rows.map(mapProduct), page: query.page, pageSize: query.pageSize, total };
  }

  async create(tenantId: string, input: CatalogueProductCreate): Promise<CatalogueProduct> {
    try {
      const row = await this.prisma.product.create({
        data: mapCreate(tenantId, input),
        select: productSelect,
      });
      return mapProduct(row);
    } catch (error) {
      throwUniqueSkuConflict(error);
    }
  }

  async update(tenantId: string, id: string, input: CatalogueProductUpdate): Promise<CatalogueProduct> {
    try {
      const result = await this.prisma.product.updateMany({
        where: { id, tenantId },
        data: mapUpdate(input),
      });
      if (result.count !== 1) throw new NotFoundException('Catalogue product not found');
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throwUniqueSkuConflict(error);
    }
    return this.findOne(tenantId, id);
  }

  async clear(tenantId: string, userId: string): Promise<{ deleted: number }> {
    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.product.deleteMany({ where: { tenantId } });
      await transaction.securityAuditLog.create({ data: {
        tenantId,
        userId,
        actor: 'USER',
        action: 'CATALOGUE_CLEARED',
        result: 'SUCCESS',
        metadata: { deleted: result.count },
      } });
      return { deleted: result.count };
    });
  }

  private async findOne(tenantId: string, id: string): Promise<CatalogueProduct> {
    const row = await this.prisma.product.findFirst({ where: { id, tenantId }, select: productSelect });
    if (!row) throw new NotFoundException('Catalogue product not found');
    return mapProduct(row);
  }
}

const productSelect = {
  id: true,
  sku: true,
  name: true,
  description: true,
  price: true,
  currency: true,
  stockQuantity: true,
  category: true,
  brand: true,
  aliases: true,
  color: true,
  size: true,
  imageUrls: true,
  attributes: true,
  active: true,
  sourceId: true,
  sourceRowKey: true,
  sourceUpdatedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function mapCreate(tenantId: string, input: CatalogueProductCreate): Prisma.ProductUncheckedCreateInput {
  const data: Prisma.ProductUncheckedCreateInput = {
    tenantId,
    sku: normalizeSku(input.sku),
    name: input.name.trim(),
    aliases: normalizedAliases(input.aliases ?? []),
    imageUrls: input.imageUrls ?? [],
    attributes: (input.attributes ?? {}) as Prisma.InputJsonValue,
    active: input.active ?? true,
  };
  if (input.description !== undefined) data.description = input.description;
  if (input.price !== undefined) data.price = input.price;
  if (input.currency !== undefined) data.currency = input.currency?.trim().toUpperCase() ?? null;
  if (input.stockQuantity !== undefined) data.stockQuantity = input.stockQuantity;
  if (input.category !== undefined) data.category = input.category;
  if (input.brand !== undefined) data.brand = input.brand;
  if (input.color !== undefined) data.color = input.color;
  if (input.size !== undefined) data.size = input.size;
  return data;
}

function mapUpdate(input: CatalogueProductUpdate): Prisma.ProductUpdateManyMutationInput {
  const data: Prisma.ProductUpdateManyMutationInput = {};
  if (input.sku !== undefined) data.sku = normalizeSku(input.sku);
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.description !== undefined) data.description = input.description;
  if (input.price !== undefined) data.price = input.price;
  if (input.currency !== undefined) data.currency = input.currency?.trim().toUpperCase() ?? null;
  if (input.stockQuantity !== undefined) data.stockQuantity = input.stockQuantity;
  if (input.category !== undefined) data.category = input.category;
  if (input.brand !== undefined) data.brand = input.brand;
  if (input.aliases !== undefined) data.aliases = normalizedAliases(input.aliases);
  if (input.color !== undefined) data.color = input.color;
  if (input.size !== undefined) data.size = input.size;
  if (input.imageUrls !== undefined) data.imageUrls = input.imageUrls;
  if (input.attributes !== undefined) data.attributes = input.attributes as Prisma.InputJsonValue;
  if (input.active !== undefined) data.active = input.active;
  return data;
}

function mapProduct(row: Prisma.ProductGetPayload<{ select: typeof productSelect }>): CatalogueProduct {
  return {
    ...row,
    price: row.price === null ? null : Number(row.price),
    aliases: stringArray(row.aliases),
    imageUrls: stringArray(row.imageUrls),
    attributes: objectValue(row.attributes),
    sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  } as CatalogueProduct;
}

function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

function normalizedAliases(aliases: string[]): string[] {
  const normalized = aliases.map((alias) => alias.trim());
  if (normalized.some((alias) => !alias) || new Set(normalized).size !== normalized.length) {
    throw new ConflictException('Catalogue aliases must be unique non-empty strings');
  }
  return normalized;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function throwUniqueSkuConflict(error: unknown): never {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
    throw new ConflictException('Catalogue SKU already exists');
  }
  throw error;
}

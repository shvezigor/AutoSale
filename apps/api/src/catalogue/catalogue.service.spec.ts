import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { CatalogueService } from './catalogue.service.js';

const product = {
  id: '11111111-1111-4111-8111-111111111111',
  sku: 'LUNA-01',
  name: 'Luna',
  description: null,
  price: null,
  currency: null,
  stockQuantity: null,
  category: null,
  brand: null,
  aliases: [],
  color: null,
  size: null,
  imageUrls: [],
  attributes: {},
  active: true,
  sourceId: null,
  sourceRowKey: null,
  sourceUpdatedAt: null,
  createdAt: new Date('2026-08-31T10:00:00.000Z'),
  updatedAt: new Date('2026-08-31T10:00:00.000Z'),
};

describe('CatalogueService', () => {
  it('never returns another tenant product', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const service = new CatalogueService({ product: { findMany, count } } as never);

    await service.list('tenant-a', { search: 'Luna', page: 1, pageSize: 25 });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 'tenant-a' }),
    }));
  });

  it('normalizes a SKU before creating a product', async () => {
    const create = vi.fn().mockResolvedValue(product);
    const service = new CatalogueService({ product: { create } } as never);

    await service.create('tenant-a', { sku: ' luna-01 ', name: 'Luna', aliases: [] });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: 'tenant-a', sku: 'LUNA-01' }),
    }));
  });

  it('maps a duplicate tenant SKU to a conflict response', async () => {
    const create = vi.fn().mockRejectedValue({ code: 'P2002' });
    const service = new CatalogueService({ product: { create } } as never);

    await expect(service.create('tenant-a', { sku: 'LUNA-01', name: 'Luna', aliases: [] }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects duplicate aliases before creating a product', async () => {
    const create = vi.fn();
    const service = new CatalogueService({ product: { create } } as never);

    await expect(service.create('tenant-a', { sku: 'LUNA-01', name: 'Luna', aliases: ['Moon', ' Moon '] }))
      .rejects.toBeInstanceOf(ConflictException);

    expect(create).not.toHaveBeenCalled();
  });

  it('does not update a product outside the authenticated tenant', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findFirst = vi.fn();
    const service = new CatalogueService({ product: { updateMany, findFirst } } as never);

    await expect(service.update('tenant-b', product.id, { name: 'Other' })).rejects.toBeInstanceOf(NotFoundException);

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: product.id, tenantId: 'tenant-b' } }));
    expect(findFirst).not.toHaveBeenCalled();
  });
});

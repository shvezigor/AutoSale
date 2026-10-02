import type { CatalogueProduct, ManagerOrder } from '@autosale/contracts';
import { describe, expect, it, vi } from 'vitest';

import { SearchService } from './search.service.js';

const orderId = 'b46c9029-ecdd-4fa5-8c0a-e3146ffe3168';
const productId = 'e46c9029-ecdd-4fa5-8c0a-e3146ffe3168';

describe('SearchService', () => {
  it('groups bounded results from the existing tenant services', async () => {
    const orders = { list: vi.fn().mockResolvedValue({ items: [order()], page: 1, pageSize: 5, total: 1 }) };
    const catalogue = { list: vi.fn().mockResolvedValue({ items: [product()], page: 1, pageSize: 5, total: 1 }) };
    const result = await new SearchService(orders as never, catalogue as never).search('tenant-a', { q: 'Олена', limit: 5 });

    expect(orders.list).toHaveBeenCalledWith('tenant-a', {
      search: 'Олена', page: 1, pageSize: 5, sort: 'date', direction: 'desc',
    });
    expect(catalogue.list).toHaveBeenCalledWith('tenant-a', {
      search: 'Олена', page: 1, pageSize: 5, sort: 'name', direction: 'asc',
    });
    expect(result).toEqual({
      query: 'Олена',
      customers: [{ key: 'phone:0970000000', name: 'Олена', context: '0970000000', href: '/orders?search=0970000000' }],
      orders: [{ id: orderId, publicNumber: 'SA-261002', customerName: 'Олена', productSummary: 'Двері', status: 'APPROVED', href: `/orders/${orderId}` }],
      products: [{ id: productId, sku: 'AUTO-1', name: 'Двері', price: 3700, currency: 'UAH', stockQuantity: 7, href: '/catalogue?search=AUTO-1' }],
    });
  });

  it('deduplicates customers by phone and falls back to username then normalized name', async () => {
    const orders = { list: vi.fn().mockResolvedValue({
      items: [
        order(),
        order({ id: 'c46c9029-ecdd-4fa5-8c0a-e3146ffe3168', customer: { name: 'Інша назва', phone: ' 0970000000 ', instagramUsername: 'ignored' } }),
        order({ id: 'd46c9029-ecdd-4fa5-8c0a-e3146ffe3168', customer: { name: null, phone: null, instagramUsername: '@olena_shop' } }),
        order({ id: 'f46c9029-ecdd-4fa5-8c0a-e3146ffe3168', customer: { name: '  Марія  ', phone: null, instagramUsername: null } }),
      ],
      page: 1, pageSize: 5, total: 4,
    }) };
    const catalogue = { list: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 5, total: 0 }) };

    const result = await new SearchService(orders as never, catalogue as never).search('tenant-a', { q: 'Ол', limit: 5 });

    expect(result.customers).toEqual([
      { key: 'phone:0970000000', name: 'Олена', context: '0970000000', href: '/orders?search=0970000000' },
      { key: 'instagram:olena_shop', name: '@olena_shop', context: 'Instagram', href: '/orders?search=%40olena_shop' },
      { key: 'name:марія', name: 'Марія', context: null, href: '/orders?search=%D0%9C%D0%B0%D1%80%D1%96%D1%8F' },
    ]);
  });

  it('omits orders without a usable customer identity from the customer group', async () => {
    const orders = { list: vi.fn().mockResolvedValue({ items: [order({ customer: { name: null, phone: null, instagramUsername: null } })], page: 1, pageSize: 5, total: 1 }) };
    const catalogue = { list: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 5, total: 0 }) };

    const result = await new SearchService(orders as never, catalogue as never).search('tenant-a', { q: 'AS', limit: 5 });

    expect(result.customers).toEqual([]);
    expect(result.orders).toHaveLength(1);
  });
});

function order(overrides: Partial<ManagerOrder> = {}): ManagerOrder {
  return {
    id: orderId,
    publicNumber: 'SA-261002',
    status: 'APPROVED',
    participantName: 'Олена',
    channel: 'INSTAGRAM',
    overallConfidence: 0.97,
    validationIssues: [],
    intentDetection: null,
    customer: { name: 'Олена', phone: '0970000000', instagramUsername: 'olena_shop' },
    delivery: { city: 'Луцьк', address: null, novaPoshtaBranch: '22' },
    items: [{
      id: 'a46c9029-ecdd-4fa5-8c0a-e3146ffe3168', catalogId: 'AUTO-1', productName: 'Двері', originalText: 'Двері', quantity: 1, color: null, size: null, confidence: 0.97,
      procurementStatus: 'IN_STOCK', procurementSource: null, procurementReason: null, stockAtDecision: null, availableAtDecision: null, reservation: null,
      unitPriceSnapshot: '3700', currencySnapshot: 'UAH', lineTotalSnapshot: '3700',
    }],
    commercialTerms: null,
    paymentSummary: null,
    procurementSummary: 'READY',
    procurementHandedOffAt: null,
    supplierDispatch: null,
    shipment: null,
    canCreateShipment: true,
    catalogueCandidates: [],
    createdAt: '2026-10-02T10:00:00.000Z',
    sheetsExport: null,
    ...overrides,
  };
}

function product(): CatalogueProduct {
  return {
    id: productId,
    sku: 'AUTO-1',
    name: 'Двері',
    description: null,
    price: 3700,
    currency: 'UAH',
    stockQuantity: 7,
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
    createdAt: '2026-10-02T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
  };
}

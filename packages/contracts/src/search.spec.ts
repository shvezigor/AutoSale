import { describe, expect, it } from 'vitest';

import { workspaceSearchQuerySchema, workspaceSearchResponseSchema } from './search.js';

describe('workspace search contracts', () => {
  it('normalizes a bounded search query', () => {
    expect(workspaceSearchQuerySchema.parse({ q: '  Ігор  ', limit: '5' })).toEqual({ q: 'Ігор', limit: 5 });
    expect(() => workspaceSearchQuerySchema.parse({ q: 'a' })).toThrow();
    expect(() => workspaceSearchQuerySchema.parse({ q: 'x'.repeat(101) })).toThrow();
    expect(() => workspaceSearchQuerySchema.parse({ q: 'Ігор', limit: '11' })).toThrow();
  });

  it('accepts grouped results with safe local destinations', () => {
    const result = workspaceSearchResponseSchema.parse({
      query: 'AS-260918',
      customers: [{ key: 'phone:+380501112233', name: 'Олена', context: '+380501112233', href: '/orders?search=%2B380501112233' }],
      orders: [{ id: 'b46c9029-ecdd-4fa5-8c0a-e3146ffe3168', publicNumber: 'AS-260918', customerName: 'Олена', productSummary: 'Двері', status: 'APPROVED', href: '/orders/b46c9029-ecdd-4fa5-8c0a-e3146ffe3168' }],
      products: [{ id: 'e46c9029-ecdd-4fa5-8c0a-e3146ffe3168', sku: 'AUTO-1', name: 'Двері', price: 3700, currency: 'UAH', stockQuantity: 7, href: '/catalogue?search=AUTO-1' }],
    });

    expect(result.query).toBe('AS-260918');
    expect(result.orders[0]?.status).toBe('APPROVED');
  });

  it('rejects external destinations and oversized result groups', () => {
    const base = { query: 'AS', customers: [], orders: [], products: [] };
    expect(() => workspaceSearchResponseSchema.parse({
      ...base,
      customers: [{ key: 'name:olena', name: 'Олена', context: null, href: 'https://example.com' }],
    })).toThrow();
    expect(() => workspaceSearchResponseSchema.parse({
      ...base,
      products: Array.from({ length: 11 }, (_, index) => ({
        id: 'e46c9029-ecdd-4fa5-8c0a-e3146ffe3168', sku: `AUTO-${index}`, name: 'Двері', price: null, currency: null, stockQuantity: null, href: `/catalogue?search=AUTO-${index}`,
      })),
    })).toThrow();
  });
});

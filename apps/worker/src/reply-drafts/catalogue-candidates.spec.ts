import { describe, expect, it } from 'vitest';
import { selectCatalogueCandidates } from './catalogue-candidates.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const product = (id: number, overrides: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  tenantId, sku: `DOOR-${id}`, name: `Fictional door ${id}`, aliases: [],
  brand: null, category: 'doors', color: 'white', size: '90x200', attributes: null,
  price: '1500.00', currency: 'UAH', stockQuantity: null, active: true,
  updatedAt: new Date('2026-10-05T10:00:00.000Z'), ...overrides,
});

describe('selectCatalogueCandidates', () => {
  it('prioritizes exact SKU and excludes foreign or inactive products', () => {
    const result = selectCatalogueCandidates([
      product(1), product(2, { tenantId: '22222222-2222-4222-8222-222222222222' }),
      product(3, { active: false }), product(4, { aliases: ['Fictional door'] }),
    ], tenantId, 'How much is DOOR-1?', [], 8);
    expect(result.map((item) => item.sku)).toEqual(['DOOR-1']);
  });

  it('does not confuse a short SKU with a longer SKU sharing its prefix', () => {
    const result = selectCatalogueCandidates([product(1), product(10)], tenantId, 'Do you have DOOR-10?', [], 8);
    expect(result.map((item) => item.sku)).toEqual(['DOOR-10']);
  });

  it('returns at most eight stable, safe snapshots with explicit stock', () => {
    const result = selectCatalogueCandidates(Array.from({ length: 12 }, (_, index) => product(index + 1)),
      tenantId, 'Fictional door', [], 8);
    expect(result).toHaveLength(8);
    expect(result[0]?.sku).toBe('DOOR-1');
    expect(result[0]?.stockQuantity).toBeNull();
    expect(result[0]).not.toHaveProperty('description');
    expect(result[0]).not.toHaveProperty('aliases');
  });

  it('distinguishes zero stock and missing currency from availability and price', () => {
    const [zero, noCurrency] = selectCatalogueCandidates([
      product(1, { stockQuantity: 0 }), product(2, { currency: null }),
    ], tenantId, 'Fictional door', [], 8);
    expect(zero?.stockQuantity).toBe(0);
    expect(zero?.price).toBe('1500.00');
    expect(noCurrency?.price).toBeNull();
    expect(noCurrency?.currency).toBeNull();
  });

  it('uses bounded recent context for a follow-up question', () => {
    const result = selectCatalogueCandidates([product(1), product(2)], tenantId,
      'Is it available?', ['I mean DOOR-2'], 8);
    expect(result[0]?.sku).toBe('DOOR-2');
  });
});

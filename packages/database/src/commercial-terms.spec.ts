import { describe, expect, it } from 'vitest';

import { calculateCommercialTerms } from './commercial-terms.js';

describe('calculateCommercialTerms', () => {
  it('uses decimal strings and quantity without floating point drift', () => {
    expect(calculateCommercialTerms([
      { itemId: 'one', quantity: 3, unitPrice: '0.10', currency: 'UAH', sourceSku: 'SKU-1' },
    ])).toEqual({
      pricingStatus: 'READY',
      currency: 'UAH',
      itemsSubtotal: '0.30',
      totalAmount: '0.30',
      issueCodes: [],
      lines: [{ itemId: 'one', quantity: 3, unitPrice: '0.10', currency: 'UAH', sourceSku: 'SKU-1', lineTotal: '0.30' }],
    });
  });

  it('refuses missing prices without inventing a total', () => {
    expect(calculateCommercialTerms([
      { itemId: 'one', quantity: 1, unitPrice: null, currency: null, sourceSku: null },
    ])).toEqual({
      pricingStatus: 'NEEDS_REVIEW',
      currency: null,
      itemsSubtotal: null,
      totalAmount: null,
      issueCodes: ['ITEM_PRICE_MISSING', 'ITEM_CURRENCY_MISSING'],
      lines: [{ itemId: 'one', quantity: 1, unitPrice: null, currency: null, sourceSku: null, lineTotal: null }],
    });
  });

  it('refuses mixed currencies', () => {
    expect(calculateCommercialTerms([
      { itemId: 'one', quantity: 1, unitPrice: '5.00', currency: 'UAH', sourceSku: 'SKU-1' },
      { itemId: 'two', quantity: 1, unitPrice: '2.00', currency: 'USD', sourceSku: 'SKU-2' },
    ])).toMatchObject({
      pricingStatus: 'NEEDS_REVIEW',
      currency: null,
      itemsSubtotal: null,
      totalAmount: null,
      issueCodes: ['MIXED_CURRENCIES'],
    });
  });
});

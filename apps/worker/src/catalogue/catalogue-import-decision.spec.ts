import { describe, expect, it } from 'vitest';

import { decideCatalogueImport } from './catalogue-import-decision.js';

describe('decideCatalogueImport', () => {
  it('auto-imports a confident mapping with populated product names', () => {
    expect(decideCatalogueImport({
      columns: [
        { source: 'Назва', target: 'name', confidence: 0.98 },
        { source: 'Ціна', target: 'price', confidence: 0.96 },
      ],
      sampleRows: [{ назва: 'Сукня Лада', ціна: '1200' }],
    })).toEqual({ action: 'AUTO_IMPORT', reasons: [] });
  });

  it('requires review when the product name mapping is missing', () => {
    expect(decideCatalogueImport({
      columns: [{ source: 'Опис', target: 'description', confidence: 0.99 }],
      sampleRows: [{ опис: 'Літня сукня' }],
    })).toEqual({ action: 'REVIEW_REQUIRED', reasons: ['NAME_MAPPING_MISSING'] });
  });

  it('requires review when a canonical target is mapped twice', () => {
    expect(decideCatalogueImport({
      columns: [
        { source: 'Назва', target: 'name', confidence: 0.98 },
        { source: 'Товар', target: 'name', confidence: 0.97 },
      ],
      sampleRows: [{ назва: 'Сукня', товар: 'Сукня' }],
    })).toEqual({ action: 'REVIEW_REQUIRED', reasons: ['DUPLICATE_TARGET'] });
  });

  it('requires review for low-confidence semantic mappings', () => {
    expect(decideCatalogueImport({
      columns: [{ source: 'Щось', target: 'name', confidence: 0.71 }],
      sampleRows: [{ щось: 'Сукня' }],
    })).toEqual({ action: 'REVIEW_REQUIRED', reasons: ['LOW_CONFIDENCE'] });
  });

  it('requires review when sampled product names are empty', () => {
    expect(decideCatalogueImport({
      columns: [{ source: 'Назва', target: 'name', confidence: 0.99 }],
      sampleRows: [{ назва: '' }, { назва: '  ' }],
    })).toEqual({ action: 'REVIEW_REQUIRED', reasons: ['PRODUCT_NAME_EMPTY'] });
  });

  it('allows an absent SKU because AutoSale can generate it', () => {
    expect(decideCatalogueImport({
      columns: [{ source: 'Назва', target: 'name', confidence: 0.99 }],
      sampleRows: [{ назва: 'Сукня' }],
    }).action).toBe('AUTO_IMPORT');
  });

  it('requires review when one SKU identifies different sampled products', () => {
    expect(decideCatalogueImport({
      columns: [
        { source: 'Артикул', target: 'sku', confidence: 0.99 },
        { source: 'Назва', target: 'name', confidence: 0.99 },
      ],
      sampleRows: [
        { артикул: 'A-1', назва: 'Сукня' },
        { артикул: 'A-1', назва: 'Костюм' },
      ],
    })).toEqual({ action: 'REVIEW_REQUIRED', reasons: ['SKU_CONFLICT'] });
  });
});

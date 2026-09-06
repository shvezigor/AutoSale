import type { RawCatalogueMatrix, TableStructureProposal } from '@autosale/contracts';
import { describe, expect, it } from 'vitest';

import { normalizeCatalogueRows } from './catalogue-row-classifier.js';

const proposal: TableStructureProposal = {
  headerStartRow: 21, headerEndRow: 22, dataStartRow: 24, structureConfidence: 0.97,
  columns: [
    { index: 5, label: 'Асортимент', target: 'name', confidence: 0.98 },
    { index: 7, label: 'Ціна', target: 'price', confidence: 0.99 },
  ],
};

describe('normalizeCatalogueRows', () => {
  it('imports priced products and skips category and secondary header rows', () => {
    const matrix: RawCatalogueMatrix = {
      revision: 'metrdoor-v1',
      rows: [
        { rowNumber: 21, cells: [null, null, null, null, null, 'Асортимент', null, 'Ціна (грн)'] },
        { rowNumber: 22, cells: [null, null, null, null, null, '', null, 'Роздріб'] },
        { rowNumber: 23, cells: [null, null, null, null, null, 'Модель', null, 'Ціна'] },
        { rowNumber: 24, cells: [null, null, null, null, null, '860х2050 Регіон', null, 2420] },
        { rowNumber: 28, cells: [null, null, null, null, null, 'Додаткова комплектація', null, null] },
      ],
    };

    const result = normalizeCatalogueRows({ matrix, proposal });

    expect(result.headers).toEqual(['Асортимент', 'Ціна (грн) / Роздріб']);
    expect(result.products).toContainEqual({ sourceRowNumber: 24, cells: ['860х2050 Регіон', 2420] });
    expect(result.skippedRowNumbers).toEqual(expect.arrayContaining([22, 23, 28]));
  });

  it('keeps uncertain one-column product-shaped rows for AI instead of dropping them', () => {
    const matrix: RawCatalogueMatrix = {
      revision: 'one-column',
      rows: [
        { rowNumber: 7, cells: ['Назва'] },
        { rowNumber: 8, cells: ['Двері Неаполь'] },
      ],
    };
    const oneColumn: TableStructureProposal = {
      headerStartRow: 7, headerEndRow: 7, dataStartRow: 8, structureConfidence: 0.8,
      columns: [{ index: 0, label: 'Назва', target: 'name', confidence: 0.9 }],
    };

    const result = normalizeCatalogueRows({ matrix, proposal: oneColumn });

    expect(result.ambiguous.map((row) => row.sourceRowNumber)).toContain(8);
  });
});

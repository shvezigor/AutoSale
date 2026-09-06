import type { RawCatalogueMatrix } from '@autosale/contracts';
import { describe, expect, it } from 'vitest';

import { buildCatalogueStructureProfile } from './catalogue-table-profiler.js';

describe('buildCatalogueStructureProfile', () => {
  it('keeps leading and distributed evidence within privacy bounds', () => {
    const matrix: RawCatalogueMatrix = {
      revision: 'rev-5000',
      rows: Array.from({ length: 5_000 }, (_, index) => ({
        rowNumber: index + 1,
        cells: [`${index}-${'x'.repeat(300)}`, index, index % 2 === 0],
      })),
    };

    const profile = buildCatalogueStructureProfile(matrix);

    expect(profile.rows.length).toBeLessThanOrEqual(160);
    expect(profile.rows.flatMap((row) => row.cells).every((cell) => String(cell.value ?? '').length <= 200)).toBe(true);
    expect(profile.totalRows).toBe(5_000);
    expect(profile.rows.at(-1)?.rowNumber).toBe(5_000);
  });

  it('preserves original indexes and infers bounded column types', () => {
    const profile = buildCatalogueStructureProfile({
      revision: 'rev-sparse',
      rows: [
        { rowNumber: 7, cells: [null, 'Назва', null, 'Ціна'] },
        { rowNumber: 8, cells: [null, 'Двері', null, 2400] },
      ],
    });

    expect(profile.rows[0]?.cells).toEqual([
      { index: 1, value: 'Назва' },
      { index: 3, value: 'Ціна' },
    ]);
    expect(profile.columnTypes).toEqual({ 1: 'string', 3: 'mixed' });
    expect(profile.maxColumns).toBe(4);
  });
});

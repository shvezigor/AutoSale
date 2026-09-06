import { describe, expect, it } from 'vitest';

import { matrixFromRows } from './catalogue-matrix.js';

describe('matrixFromRows', () => {
  it('preserves original row and column coordinates without requiring row one headers', () => {
    const matrix = matrixFromRows([
      [],
      [null, null, 'Постачальник'],
      [],
      [null, null, 'Назва', null, 'Ціна'],
      [null, null, 'Сукня', null, 1200],
    ], 'revision-1');

    expect(matrix.rows[3]).toEqual({ rowNumber: 4, cells: [null, null, 'Назва', null, 'Ціна'] });
    expect(matrix.rows[4]).toEqual({ rowNumber: 5, cells: [null, null, 'Сукня', null, 1200] });
  });

  it('rejects populated rows and columns outside the bounded analysis matrix', () => {
    const rows = Array.from({ length: 5_001 }, () => [] as unknown[]);
    rows[5_000] = ['outside'];

    expect(() => matrixFromRows(rows, 'revision-1')).toThrow('5000');
    expect(() => matrixFromRows([Array(501).fill('value')], 'revision-1')).toThrow('500');
  });
});

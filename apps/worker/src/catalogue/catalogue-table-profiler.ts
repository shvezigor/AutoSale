import type { RawCatalogueCell, RawCatalogueMatrix } from '@autosale/contracts';

export type CatalogueProfilePrimitiveType = 'string' | 'number' | 'boolean' | 'mixed';

export interface CatalogueStructureProfileCell {
  index: number;
  value: RawCatalogueCell;
}

export interface CatalogueStructureProfileRow {
  rowNumber: number;
  cells: CatalogueStructureProfileCell[];
}

export interface CatalogueStructureProfile {
  totalRows: number;
  maxColumns: number;
  rows: CatalogueStructureProfileRow[];
  columnTypes: Record<number, CatalogueProfilePrimitiveType>;
}

const LEADING_ROWS = 120;
const DISTRIBUTED_ROWS = 40;
const MAX_TEXT_LENGTH = 200;

export function buildCatalogueStructureProfile(matrix: RawCatalogueMatrix): CatalogueStructureProfile {
  const nonEmpty = matrix.rows.filter((row) => row.cells.some(hasValue));
  const leading = nonEmpty.slice(0, LEADING_ROWS);
  const distributed = evenlySample(nonEmpty.slice(LEADING_ROWS), DISTRIBUTED_ROWS);
  const selected = new Map([...leading, ...distributed].map((row) => [row.rowNumber, row]));

  return {
    totalRows: matrix.rows.length,
    maxColumns: matrix.rows.reduce((maximum, row) => Math.max(maximum, row.cells.length), 0),
    rows: [...selected.values()].sort((left, right) => left.rowNumber - right.rowNumber).map((row) => ({
      rowNumber: row.rowNumber,
      cells: row.cells.flatMap((value, index) => hasValue(value)
        ? [{ index, value: boundValue(value) }]
        : []),
    })),
    columnTypes: inferColumnTypes(matrix),
  };
}

function evenlySample<T>(values: T[], limit: number): T[] {
  if (values.length <= limit) return values;
  if (limit <= 1) return values.length === 0 ? [] : [values.at(-1)!];
  return Array.from({ length: limit }, (_, index) => values[Math.round(index * (values.length - 1) / (limit - 1))]!);
}

function inferColumnTypes(matrix: RawCatalogueMatrix): Record<number, CatalogueProfilePrimitiveType> {
  const observed = new Map<number, Set<CatalogueProfilePrimitiveType>>();
  for (const row of matrix.rows) {
    row.cells.forEach((value, index) => {
      if (!hasValue(value)) return;
      const type = typeof value as CatalogueProfilePrimitiveType;
      const types = observed.get(index) ?? new Set<CatalogueProfilePrimitiveType>();
      types.add(type);
      observed.set(index, types);
    });
  }
  const result: Record<number, CatalogueProfilePrimitiveType> = {};
  for (const [index, types] of observed) {
    result[index] = types.size === 1 ? [...types][0]! : 'mixed';
  }
  return result;
}

function hasValue(value: RawCatalogueCell): boolean {
  return value !== null && (typeof value !== 'string' || value.trim().length > 0);
}

function boundValue(value: RawCatalogueCell): RawCatalogueCell {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT_LENGTH) : value;
}

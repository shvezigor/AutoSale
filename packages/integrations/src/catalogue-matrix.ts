import { rawCatalogueMatrixSchema, type RawCatalogueCell, type RawCatalogueMatrix } from '@autosale/contracts';

const MAX_ROWS = 5_000;
const MAX_COLUMNS = 500;
const MAX_CELL_CHARACTERS = 65_536;

export function matrixFromRows(rows: unknown[][], revision: string): RawCatalogueMatrix {
  if (rows.slice(MAX_ROWS).some((row) => row.some(hasCatalogueValue))) {
    throw new RangeError(`Catalogue matrix exceeds ${MAX_ROWS} populated rows`);
  }
  const acceptedRows = rows.slice(0, MAX_ROWS).map((row, index) => {
    if (row.length > MAX_COLUMNS && row.slice(MAX_COLUMNS).some(hasCatalogueValue)) {
      throw new RangeError(`Catalogue matrix exceeds ${MAX_COLUMNS} populated columns`);
    }
    return {
      rowNumber: index + 1,
    cells: Array.from(row.slice(0, MAX_COLUMNS), normalizeCatalogueCell),
    };
  });

  return rawCatalogueMatrixSchema.parse({ revision, rows: acceptedRows });
}

function hasCatalogueValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function normalizeCatalogueCell(value: unknown): RawCatalogueCell {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text = typeof value === 'string' ? value : String(value);
  if (text.length > MAX_CELL_CHARACTERS) throw new RangeError(`Catalogue cell exceeds ${MAX_CELL_CHARACTERS} characters`);
  return text;
}

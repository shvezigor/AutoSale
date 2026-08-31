import { createHash } from 'node:crypto';

import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

export type ParsedCell = string | number | boolean | null;

export type ParsedTable = {
  headers: string[];
  rows: Array<Record<string, ParsedCell>>;
  fingerprint: string;
};

const CSV_MEDIA_TYPES = new Set(['text/csv', 'application/csv']);
const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_COLUMNS = 100;
const MAX_ROWS = 10_000;
const MAX_CELL_BYTES = 65_536;
const ENCRYPTED_OFFICE_MAGIC = Buffer.from('d0cf11e0a1b11ae1', 'hex');

export async function parseCatalogueSource(buffer: Buffer, mediaType: string): Promise<ParsedTable> {
  if (!CSV_MEDIA_TYPES.has(mediaType) && mediaType !== XLSX_MEDIA_TYPE) {
    throw new Error('Unsupported catalogue source type');
  }
  if (mediaType === XLSX_MEDIA_TYPE && buffer.subarray(0, ENCRYPTED_OFFICE_MAGIC.length).equals(ENCRYPTED_OFFICE_MAGIC)) {
    throw new Error('Encrypted workbooks are not supported');
  }
  const matrix = CSV_MEDIA_TYPES.has(mediaType)
    ? parseCsv(buffer, { bom: true, relax_column_count: false, skip_empty_lines: true }) as unknown[][]
    : await readWorkbook(buffer);
  const headers = (matrix[0] ?? []).map((cell) => String(cell).trim().toLocaleLowerCase('en-US'));
  validateBounds(matrix, headers);
  const rows = matrix.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, normalizeCell(row[index])]))) as Array<Record<string, ParsedCell>>;
  return {
    headers,
    rows,
    fingerprint: createHash('sha256').update(JSON.stringify(headers)).digest('hex'),
  };
}

async function readWorkbook(buffer: Buffer): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];
  const rows: unknown[][] = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const values = Array.isArray(row.values) ? row.values.slice(1).map(readExcelCell) : [];
    rows.push(values);
  });
  return rows;
}

function readExcelCell(value: ExcelJS.CellValue | undefined): unknown {
  if (value && typeof value === 'object' && 'formula' in value) {
    if (value.result === undefined || value.result === null) throw new Error('Formula cells require cached values');
    return value.result;
  }
  if (value && typeof value === 'object' && 'richText' in value) {
    return value.richText.map((part) => part.text).join('');
  }
  if (value && typeof value === 'object' && 'text' in value) return value.text;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function validateBounds(matrix: unknown[][], headers: string[]): void {
  if (headers.length === 0 || headers.some((header) => header === '')) throw new Error('Catalogue headers must be non-empty');
  if (headers.length > MAX_COLUMNS) throw new Error('Catalogue source has too many columns');
  if (new Set(headers).size !== headers.length) throw new Error('Catalogue headers must be unique after normalization');
  if (matrix.length - 1 > MAX_ROWS) throw new Error('Catalogue source has too many rows');
  for (const row of matrix) {
    for (const cell of row) {
      if (typeof cell === 'string' && Buffer.byteLength(cell, 'utf8') > MAX_CELL_BYTES) {
        throw new Error('Catalogue cell is too large');
      }
    }
  }
}

function normalizeCell(value: unknown): ParsedCell {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text = String(value).trim();
  if (text === '') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?(?:\d+|\d*\.\d+)$/.test(text)) return Number(text);
  return text;
}

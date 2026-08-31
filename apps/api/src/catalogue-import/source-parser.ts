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
const MAX_XLSX_ENTRIES = 256;
const MAX_XLSX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_XLSX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_XLSX_COMPRESSION_RATIO = 1_000;
const ENCRYPTED_OFFICE_MAGIC = Buffer.from('d0cf11e0a1b11ae1', 'hex');

export async function parseCatalogueSource(buffer: Buffer, mediaType: string): Promise<ParsedTable> {
  if (!CSV_MEDIA_TYPES.has(mediaType) && mediaType !== XLSX_MEDIA_TYPE) {
    throw new Error('Unsupported catalogue source type');
  }
  if (mediaType === XLSX_MEDIA_TYPE && buffer.subarray(0, ENCRYPTED_OFFICE_MAGIC.length).equals(ENCRYPTED_OFFICE_MAGIC)) {
    throw new Error('Encrypted workbooks are not supported');
  }
  const matrix = CSV_MEDIA_TYPES.has(mediaType)
    ? readCsv(buffer)
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
  preflightWorkbookArchive(buffer);
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

function readCsv(buffer: Buffer): unknown[][] {
  let rowCount = 0;
  return parseCsv(buffer, {
    bom: true,
    relax_column_count: false,
    skip_empty_lines: true,
    max_record_size: MAX_COLUMNS * (MAX_CELL_BYTES + 8),
    on_record(record) {
      rowCount += 1;
      if (rowCount > MAX_ROWS + 1) throw new Error('Catalogue source has too many rows');
      if (!Array.isArray(record)) throw new Error('Invalid catalogue source');
      if (record.length > MAX_COLUMNS) throw new Error('Catalogue source has too many columns');
      for (const cell of record) {
        if (typeof cell === 'string' && Buffer.byteLength(cell, 'utf8') > MAX_CELL_BYTES) {
          throw new Error('Catalogue cell is too large');
        }
      }
      return record;
    },
  }) as unknown[][];
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

function preflightWorkbookArchive(buffer: Buffer): void {
  const endOffset = findEndOfCentralDirectory(buffer);
  if (endOffset < 0) throw new Error('Invalid XLSX archive');
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const directorySize = buffer.readUInt32LE(endOffset + 12);
  const directoryOffset = buffer.readUInt32LE(endOffset + 16);
  if (entryCount > MAX_XLSX_ENTRIES) throw new Error('Catalogue workbook archive has too many entries');
  if (directoryOffset + directorySize > buffer.length) throw new Error('Invalid XLSX archive');

  let offset = directoryOffset;
  let seenEntries = 0;
  let totalUncompressed = 0;
  const directoryEnd = directoryOffset + directorySize;

  while (offset < directoryEnd) {
    if (offset + 46 > directoryEnd || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid XLSX archive');
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) throw new Error('Invalid XLSX archive');

    seenEntries += 1;
    totalUncompressed += uncompressedSize;
    if (seenEntries > MAX_XLSX_ENTRIES) throw new Error('Catalogue workbook archive has too many entries');
    if (uncompressedSize > MAX_XLSX_ENTRY_BYTES || totalUncompressed > MAX_XLSX_UNCOMPRESSED_BYTES) {
      throw new Error('Catalogue workbook archive is too large');
    }
    if (uncompressedSize > 0 && (
      compressedSize === 0
      || (compressedSize > 0 && uncompressedSize / compressedSize > MAX_XLSX_COMPRESSION_RATIO)
    )) {
      throw new Error('Catalogue workbook archive is suspiciously compressed');
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  if (seenEntries !== entryCount || offset !== directoryEnd) throw new Error('Invalid XLSX archive');
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
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

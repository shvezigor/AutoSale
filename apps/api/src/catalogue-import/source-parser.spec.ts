import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';

import { parseCatalogueSource } from './source-parser.js';

const fixtures = resolve(process.cwd(), '../../tests/fixtures/catalogue');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseCatalogueSource', () => {
  it.each([
    ['products.csv', 'text/csv'],
    ['products.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ])('normalizes %s into the same typed table', async (fileName, mediaType) => {
    const parsed = await parseCatalogueSource(await readFile(resolve(fixtures, fileName)), mediaType);

    expect(parsed).toEqual({
      headers: ['sku', 'name', 'price', 'active'],
      rows: [
        { sku: 'LUNA-01', name: 'Luna Lamp', price: 1234.5, active: true },
        { sku: 'SOL-02', name: 'Sol Chair', price: 89.95, active: false },
      ],
      fingerprint: '6416a4fdf1716c68c9ca497772eb95f64e7ef345d211be59065a1ee7ec53406b',
    });
  });

  it.each([
    ['empty headers', Buffer.from('SKU,,Name\nA-1,x,Alpha'), 'text/csv'],
    ['duplicate normalized headers', Buffer.from(' SKU ,sku\nA-1,A-2'), 'text/csv'],
    ['unsupported media types', Buffer.from('SKU\nA-1'), 'application/json'],
    ['encrypted workbook containers', Buffer.from('d0cf11e0a1b11ae1', 'hex'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ])('rejects %s', async (_caseName, bytes, mediaType) => {
    await expect(parseCatalogueSource(bytes, mediaType)).rejects.toThrow();
  });

  it('rejects CSV cells over 64 KiB', async () => {
    await expect(parseCatalogueSource(Buffer.from(`SKU\n${'x'.repeat(65_537)}`), 'text/csv')).rejects.toThrow();
  });

  it('rejects more than 100 columns', async () => {
    const headers = Array.from({ length: 101 }, (_, index) => `column-${index + 1}`).join(',');
    await expect(parseCatalogueSource(Buffer.from(`${headers}\n`), 'text/csv')).rejects.toThrow();
  });

  it('rejects more than 10,000 data rows', async () => {
    const rows = Array.from({ length: 10_001 }, (_, index) => `SKU-${index + 1}`).join('\n');
    await expect(parseCatalogueSource(Buffer.from(`SKU\n${rows}`), 'text/csv')).rejects.toThrow();
  });

  it('rejects formula cells without cached values', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Products');
    sheet.addRow(['SKU', 'Name']);
    sheet.addRow(['LUNA-01', { formula: 'UPPER("Luna")' }]);
    const bytes = await workbook.xlsx.writeBuffer();

    await expect(parseCatalogueSource(Buffer.from(bytes), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).rejects.toThrow();
  });

  it('rejects oversized XLSX archive metadata before workbook load', async () => {
    const loadSpy = vi.spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), 'load')
      .mockRejectedValue(new Error('workbook load should not run'));

    await expect(parseCatalogueSource(
      createZipArchive([{ name: 'xl/worksheets/sheet1.xml', compressedSize: 32, uncompressedSize: 80 * 1024 * 1024 }]),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )).rejects.toThrow('Catalogue workbook archive is too large');

    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('rejects suspicious XLSX compression ratios before workbook load', async () => {
    const loadSpy = vi.spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), 'load')
      .mockRejectedValue(new Error('workbook load should not run'));

    await expect(parseCatalogueSource(
      createZipArchive([{ name: 'xl/sharedStrings.xml', compressedSize: 1, uncompressedSize: 2 * 1024 * 1024 }]),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )).rejects.toThrow('Catalogue workbook archive is suspiciously compressed');

    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('rejects XLSX archives with too many entries before workbook load', async () => {
    const loadSpy = vi.spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), 'load')
      .mockRejectedValue(new Error('workbook load should not run'));

    await expect(parseCatalogueSource(
      createZipArchive(Array.from({ length: 300 }, (_, index) => ({
        name: `xl/worksheets/sheet-${index + 1}.xml`,
        compressedSize: 0,
        uncompressedSize: 0,
      }))),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )).rejects.toThrow('Catalogue workbook archive has too many entries');

    expect(loadSpy).not.toHaveBeenCalled();
  });
});

function createZipArchive(entries: Array<{ name: string; compressedSize: number; uncompressedSize: number }>): Buffer {
  const records: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const localHeader = Buffer.alloc(30 + nameBytes.length + entry.compressedSize);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(entry.compressedSize, 18);
    localHeader.writeUInt32LE(entry.uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBytes.copy(localHeader, 30);

    const centralHeader = Buffer.alloc(46 + nameBytes.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(entry.compressedSize, 20);
    centralHeader.writeUInt32LE(entry.uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBytes.copy(centralHeader, 46);

    records.push(localHeader);
    directory.push(centralHeader);
    offset += localHeader.length;
  }

  const centralDirectory = Buffer.concat(directory);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(offset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...records, centralDirectory, endOfCentralDirectory]);
}

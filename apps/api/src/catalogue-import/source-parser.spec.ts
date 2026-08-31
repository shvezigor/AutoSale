import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';

import { parseCatalogueSource } from './source-parser.js';

const fixtures = resolve(process.cwd(), '../../tests/fixtures/catalogue');

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
});

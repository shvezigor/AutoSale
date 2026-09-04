import { randomUUID } from 'node:crypto';

import { importCatalogueTable, type PrismaClient } from '@autosale/database';
import type { ObjectStorage } from '@autosale/integrations';
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

import type { CatalogueMappingJob } from './catalogue-mapping.processor.js';

const LEASE_MS = 5 * 60_000;
type Importer = typeof importCatalogueTable;

export class CatalogueAutoImporter {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: ObjectStorage,
    private readonly importTable: Importer = importCatalogueTable,
  ) {}

  async process(input: CatalogueMappingJob): Promise<{ status: 'COMPLETED' }> {
    const run = await this.prisma.catalogueImportRun.findFirst({
      where: { id: input.runId, tenantId: input.tenantId, status: 'PREVIEW_READY' },
      include: {
        mapping: { select: { columns: true, transformSettings: true } },
        source: { select: { type: true, objectKey: true, syncVersion: true } },
      },
    });
    if (!run?.mapping) throw new Error('Auto import is unavailable');
    const objectKey = run.source.type === 'GOOGLE_SHEETS' ? run.snapshotObjectKey : run.source.objectKey;
    if (!objectKey) throw new Error('Auto import source is unavailable');
    const object = await this.storage.get(objectKey);
    const table = await readTable(Buffer.from(object.body), run.source.type);
    const mapping = readMapping(run.mapping.columns);
    const lease = run.source.type === 'GOOGLE_SHEETS' ? await this.claimGoogle(input, run.sourceId, run.sourceSyncVersion) : undefined;
    if (!lease) {
      const claimed = await this.prisma.catalogueImportRun.updateMany({
        where: { id: input.runId, tenantId: input.tenantId, status: 'PREVIEW_READY' },
        data: { status: 'PROCESSING', startedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error('Auto import was already claimed');
    }

    try {
      const result = await this.importTable(this.prisma, {
        tenantId: input.tenantId,
        sourceId: run.sourceId,
        headers: table.headers,
        rows: table.rows,
        mapping,
        transformSettings: run.mapping.transformSettings,
        ownershipPolicy: run.source.type === 'GOOGLE_SHEETS' ? 'FENCE_CROSS_SOURCE' : 'REASSIGN',
        ...(lease ? { lease } : {}),
      });
      const completedAt = new Date();
      if (lease) {
        const activated = await this.prisma.catalogueSource.updateMany({
          where: { id: run.sourceId, tenantId: input.tenantId, syncLeaseId: lease.id, syncVersion: lease.syncVersion, syncLeaseExpiresAt: { gt: completedAt } },
          data: { status: 'ACTIVE', lastSyncedAt: completedAt, lastErrorSummary: null, syncLeaseId: null, syncLeaseExpiresAt: null },
        });
        if (activated.count !== 1) throw new Error('Auto import lease was lost');
      } else {
        await this.prisma.catalogueSource.updateMany({ where: { id: run.sourceId, tenantId: input.tenantId }, data: { status: 'ACTIVE', lastSyncedAt: completedAt, lastErrorSummary: null } });
      }
      const completed = await this.prisma.catalogueImportRun.updateMany({
        where: { id: input.runId, tenantId: input.tenantId, status: 'PROCESSING', ...(lease ? { sourceSyncVersion: lease.syncVersion } : {}) },
        data: { status: 'COMPLETED', ...result, rowErrors: result.rowErrors as never, completedAt },
      });
      if (completed.count !== 1) throw new Error('Auto import completion was lost');
      return { status: 'COMPLETED' };
    } catch (error) {
      await this.prisma.catalogueImportRun.updateMany({
        where: { id: input.runId, tenantId: input.tenantId, status: 'PROCESSING' },
        data: { status: 'FAILED', rowErrors: [{ errors: ['IMPORT_FAILED'] }], completedAt: new Date() },
      });
      throw error;
    }
  }

  private async claimGoogle(input: CatalogueMappingJob, sourceId: string, sourceSyncVersion: number | null) {
    if (sourceSyncVersion === null) throw new Error('Google source version is unavailable');
    const id = randomUUID();
    const now = new Date();
    const claimedSource = await this.prisma.catalogueSource.updateMany({
      where: { id: sourceId, tenantId: input.tenantId, type: 'GOOGLE_SHEETS', syncVersion: sourceSyncVersion, OR: [{ syncLeaseId: null }, { syncLeaseExpiresAt: { lte: now } }] },
      data: { syncLeaseId: id, syncLeaseExpiresAt: new Date(now.getTime() + LEASE_MS), syncVersion: { increment: 1 } },
    });
    if (claimedSource.count !== 1) throw new Error('Google source changed before auto import');
    const syncVersion = sourceSyncVersion + 1;
    const claimedRun = await this.prisma.catalogueImportRun.updateMany({
      where: { id: input.runId, tenantId: input.tenantId, status: 'PREVIEW_READY', sourceSyncVersion },
      data: { status: 'PROCESSING', startedAt: now, sourceSyncVersion: syncVersion },
    });
    if (claimedRun.count !== 1) {
      await this.prisma.catalogueSource.updateMany({ where: { id: sourceId, tenantId: input.tenantId, syncLeaseId: id, syncVersion }, data: { syncLeaseId: null, syncLeaseExpiresAt: null } });
      throw new Error('Auto import was already claimed');
    }
    return { id, syncVersion, ttlMs: LEASE_MS };
  }
}

async function readTable(body: Buffer, type: 'CSV_UPLOAD' | 'XLSX_UPLOAD' | 'GOOGLE_SHEETS'): Promise<{ headers: string[]; rows: Array<Array<string | number | boolean | null>> }> {
  if (type === 'GOOGLE_SHEETS') {
    const parsed = JSON.parse(body.toString('utf8')) as { headers?: unknown; rows?: unknown };
    if (!Array.isArray(parsed.headers) || !Array.isArray(parsed.rows)) throw new Error('Invalid Google catalogue snapshot');
    return { headers: normalizeHeaders(parsed.headers.map(String)), rows: parsed.rows.map((row) => Array.isArray(row) ? row.map(cell) : []) };
  }
  if (type === 'CSV_UPLOAD') {
    const rows = parseCsv(body, { bom: true, relax_column_count: true, skip_empty_lines: true }) as unknown[][];
    return splitRows(rows);
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body as unknown as ExcelJS.Buffer);
  const rows: unknown[][] = [];
  workbook.worksheets[0]?.eachRow({ includeEmpty: false }, (row) => rows.push(Array.isArray(row.values) ? row.values.slice(1) : []));
  return splitRows(rows);
}

function splitRows(rows: unknown[][]) {
  const headers = normalizeHeaders((rows.shift() ?? []).map(String));
  return { headers, rows: rows.map((row) => headers.map((_, index) => cell(row[index]))) };
}

function normalizeHeaders(headers: string[]): string[] { return headers.map((value) => value.trim().toLocaleLowerCase('en-US')); }
function cell(value: unknown): string | number | boolean | null { return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null; }
function readMapping(value: unknown): Array<{ source: string; target: 'sku' | 'name' | 'description' | 'price' | 'currency' | 'stockQuantity' | 'category' | 'brand' | 'aliases' | 'color' | 'size' | 'imageUrls' | 'active' | 'attributes' | 'ignore' }> {
  if (!Array.isArray(value)) throw new Error('Invalid catalogue mapping');
  return value.map((item) => ({ source: String(item?.source ?? ''), target: String(item?.target ?? 'ignore') as ReturnType<typeof readMapping>[number]['target'] }));
}

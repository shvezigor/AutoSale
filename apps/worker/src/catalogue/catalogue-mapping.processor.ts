import type { PrismaClient } from '@autosale/database';
import { googleSheetsStructureFingerprint, type ObjectStorage } from '@autosale/integrations';
import { parse as parseCsv } from 'csv-parse/sync';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';

import { CatalogueMappingProviderError, CatalogueMappingResponseError, type CatalogueColumnMappingInput, type CatalogueMappingSuggestion } from './openai-column-mapper.js';
import { decideCatalogueImport } from './catalogue-import-decision.js';

// Google snapshots can legitimately contain several rich-text description cells.
// Keep this bounded, but aligned with the supported 5,000-row catalogue envelope.
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
export const CATALOGUE_MAPPING_LEASE_MS = 5 * 60 * 1_000;
export const CATALOGUE_MAPPING_HEARTBEAT_MS = 60 * 1_000;

export type CatalogueMappingJob = { tenantId: string; runId: string };

type Mapper = { suggest(input: CatalogueColumnMappingInput): Promise<CatalogueMappingSuggestion> };
type AutoImporter = { process(input: CatalogueMappingJob): Promise<{ status: 'COMPLETED' }> };

export class CatalogueMappingProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: ObjectStorage,
    private readonly mapper: Mapper,
    private readonly autoImporter?: AutoImporter,
  ) {}

  async process(job: CatalogueMappingJob): Promise<{ status: 'COMPLETED' | 'MAPPING_REVIEW' | 'SKIPPED'; proposal: CatalogueMappingSuggestion['proposal'] | null }> {
    const leaseId = randomUUID();
    const claimedAt = new Date();
    const claimed = await this.prisma.catalogueImportRun.updateMany({
      where: {
        id: job.runId, tenantId: job.tenantId,
        OR: [
          { status: 'UPLOADED' },
          { status: 'MAPPING', mappingLeaseId: { not: null }, mappingLeaseExpiresAt: { lt: claimedAt } },
        ],
      },
      data: { status: 'MAPPING', mappingLeaseId: leaseId, mappingLeaseExpiresAt: leaseExpiry(claimedAt) },
    });
    if (claimed.count !== 1) return { status: 'SKIPPED', proposal: null };

    let ownsLease = true;
    let autoImportStarted = false;
    let failureCode = 'MAPPING_RUN_UNAVAILABLE';
    const heartbeat = async (): Promise<boolean> => {
      if (!ownsLease) return false;
      const now = new Date();
      const refreshed = await this.prisma.catalogueImportRun.updateMany({
        where: {
          id: job.runId, tenantId: job.tenantId, status: 'MAPPING', mappingLeaseId: leaseId,
          // An owner may extend only its still-valid lease.  Once it has expired,
          // a reclaimed run belongs exclusively to its new lease token.
          mappingLeaseExpiresAt: { gt: now },
        },
        data: { mappingLeaseExpiresAt: leaseExpiry(now) },
      });
      ownsLease = refreshed.count === 1;
      return ownsLease;
    };
    const heartbeatTimer = setInterval(() => { void heartbeat().catch(() => { ownsLease = false; }); }, CATALOGUE_MAPPING_HEARTBEAT_MS);

    try {
      const run = await this.prisma.catalogueImportRun.findFirst({
        where: { id: job.runId, tenantId: job.tenantId, status: 'MAPPING', mappingLeaseId: leaseId },
        include: { source: { select: { objectKey: true, type: true, headerFingerprint: true } } },
      });
      const objectKey = run?.source.type === 'GOOGLE_SHEETS' ? run.snapshotObjectKey : run?.source.objectKey;
      const sourceFingerprint = run?.source.type === 'GOOGLE_SHEETS'
        ? fingerprintFromHeaders(run.sourceHeaders)
        : run?.source.headerFingerprint;
      if (!run || !objectKey || !sourceFingerprint) throw new Error('source unavailable');
      failureCode = 'MAPPING_SOURCE_INVALID';
      const input = await this.loadSource(objectKey, run.source.type);
      if (!await heartbeat()) return { status: 'SKIPPED', proposal: null };
      failureCode = 'MAPPING_RESPONSE_INVALID';
      const suggestion = await this.mapper.suggest(input);
      if (!await heartbeat()) return { status: 'SKIPPED', proposal: null };
      const decision = this.autoImporter ? decideCatalogueImport({ columns: suggestion.proposal.columns, sampleRows: input.sampleRows }) : { action: 'REVIEW_REQUIRED' as const, reasons: [] };
      const autoImport = decision.action === 'AUTO_IMPORT';

      failureCode = 'MAPPING_PERSIST_FAILED';
      await this.prisma.$transaction(async (tx) => {
        const latest = await tx.catalogueMapping.findFirst({
          where: { tenantId: job.tenantId, sourceId: run.sourceId }, orderBy: { version: 'desc' }, select: { version: true },
        });
        const mapping = await tx.catalogueMapping.create({
          data: {
            tenantId: job.tenantId, sourceId: run.sourceId, version: (latest?.version ?? 0) + 1,
            sourceFingerprint, columns: suggestion.proposal.columns,
            aiModel: suggestion.metadata.model, promptVersion: suggestion.metadata.promptVersion, schemaVersion: suggestion.metadata.schemaVersion,
            aiLatencyMs: suggestion.metadata.latencyMs, aiInputTokens: suggestion.metadata.inputTokens, aiOutputTokens: suggestion.metadata.outputTokens,
            ownerModified: false, confirmedAt: autoImport ? new Date() : null, confirmedByUserId: autoImport ? run.requestedByUserId : null,
          },
        });
        const assigned = await tx.catalogueImportRun.updateMany({
          where: {
            id: job.runId, tenantId: job.tenantId, status: 'MAPPING', mappingLeaseId: leaseId,
            mappingLeaseExpiresAt: { gt: new Date() },
          },
          data: {
            mappingId: mapping.id,
            status: autoImport ? 'PREVIEW_READY' : 'MAPPING_REVIEW',
            mappingLeaseId: null,
            mappingLeaseExpiresAt: null,
            ...(!autoImport && decision.reasons.length > 0 ? { rowErrors: [{ errors: decision.reasons }] } : {}),
          },
        });
        if (assigned.count !== 1) throw new Error('mapping assignment lost');
      });
      if (autoImport) {
        autoImportStarted = true;
        await this.autoImporter!.process(job);
        return { status: 'COMPLETED', proposal: suggestion.proposal };
      }
      return { status: 'MAPPING_REVIEW', proposal: suggestion.proposal };
    } catch (error) {
      if (autoImportStarted) throw error;
      if (!ownsLease) return { status: 'SKIPPED', proposal: null };
      const fallback = await this.prisma.catalogueImportRun.updateMany({
        where: {
          id: job.runId, tenantId: job.tenantId, status: 'MAPPING', mappingLeaseId: leaseId,
          mappingLeaseExpiresAt: { gt: new Date() },
        },
        data: {
          mappingId: null, status: 'MAPPING_REVIEW', mappingLeaseId: null, mappingLeaseExpiresAt: null,
          rowErrors: [{ errors: [mappingFailureCode(error, failureCode)] }],
        },
      });
      return fallback.count === 1 ? { status: 'MAPPING_REVIEW', proposal: null } : { status: 'SKIPPED', proposal: null };
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  private async loadSource(objectKey: string, type: 'CSV_UPLOAD' | 'XLSX_UPLOAD' | 'GOOGLE_SHEETS'): Promise<CatalogueColumnMappingInput> {
    const object = await this.storage.get(objectKey);
    const body = Buffer.from(object.body);
    if (body.length === 0 || body.length > MAX_SOURCE_BYTES) throw new Error('source size is invalid');
    const rows = type === 'CSV_UPLOAD' ? csvRows(body) : type === 'XLSX_UPLOAD' ? await xlsxRows(body) : googleSnapshotRows(body);
    const headers = normalizedHeaders(rows.shift() ?? []);
    if (headers.length === 0) throw new Error('source headers are invalid');
    const records = rows.filter((row) => row.some((value) => value !== '')).slice(0, 5).map((row) => Object.fromEntries(headers.map((header, index) => [header, boundedCell(row[index])])));
    return { headers, primitiveTypes: inferTypes(headers, records), sampleRows: records };
  }
}

function fingerprintFromHeaders(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0 || value.some((header) => typeof header !== 'string')) return null;
  return googleSheetsStructureFingerprint(value as string[]);
}

function mappingFailureCode(error: unknown, fallback: string): string {
  if (error instanceof CatalogueMappingProviderError) return error.status ? `MAPPING_PROVIDER_${error.status}` : 'MAPPING_PROVIDER_ERROR';
  if (error instanceof CatalogueMappingResponseError) return 'MAPPING_RESPONSE_INVALID';
  return fallback;
}

function googleSnapshotRows(body: Buffer): string[][] {
  const parsed = JSON.parse(body.toString('utf8')) as { headers?: unknown; rows?: unknown };
  if (!Array.isArray(parsed.headers) || !Array.isArray(parsed.rows)) throw new Error('Google Sheets snapshot is invalid');
  const headers = parsed.headers.map((cell) => String(cell ?? ''));
  const rows = parsed.rows.map((row) => {
    if (!Array.isArray(row)) throw new Error('Google Sheets snapshot row is invalid');
    return row.map((cell) => String(cell ?? ''));
  });
  return [headers, ...rows];
}

function leaseExpiry(now: Date): Date { return new Date(now.getTime() + CATALOGUE_MAPPING_LEASE_MS); }

function csvRows(body: Buffer): string[][] {
  return parseCsv(body, { bom: true, relax_column_count: true, skip_empty_lines: true }).map((row: unknown[]) => row.map((cell) => String(cell ?? '')));
}

async function xlsxRows(body: Uint8Array): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(body) as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = (Array.isArray(row.values) ? row.values.slice(1) : []) as unknown[];
    rows.push(values.map((cell) => String(cell ?? '')));
  });
  return rows;
}

function normalizedHeaders(row: string[]): string[] {
  const seen = new Set<string>();
  return row.map((value) => value.trim().toLocaleLowerCase('en-US')).filter((value) => value.length > 0 && !seen.has(value) && (seen.add(value) || true));
}

function boundedCell(value: string | undefined): string { return (value ?? '').slice(0, 500); }

function inferTypes(headers: string[], rows: Array<Record<string, string>>): CatalogueColumnMappingInput['primitiveTypes'] {
  return Object.fromEntries(headers.map((header) => {
    const values = rows.map((row) => row[header] ?? '').filter(Boolean);
    const types = new Set(values.map((value) => value === 'true' || value === 'false' ? 'boolean' : Number.isFinite(Number(value)) ? 'number' : 'string'));
    const onlyType = [...types][0];
    return [header, types.size === 0 ? 'empty' : types.size === 1 && onlyType ? onlyType : 'mixed'];
  })) as CatalogueColumnMappingInput['primitiveTypes'];
}

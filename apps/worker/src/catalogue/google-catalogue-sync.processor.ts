import { randomUUID } from 'node:crypto';

import type { CatalogueTargetField } from '@autosale/contracts';
import { CatalogueImportLeaseLostError, CatalogueSkuOwnershipError, importCatalogueTable, type CatalogueImportCounts, type PrismaClient } from '@autosale/database';
import { GoogleOAuthAccessError, GoogleSheetsReadError, GoogleSheetsTableValidationError, googleSheetsStructureFingerprint, type GoogleSheetsAdapter, type GoogleSheetsCell, type ObjectStorage } from '@autosale/integrations';

type MappingColumn = { source: string; target: CatalogueTargetField };
type TableImporter = { importTable(input: {
  tenantId: string; sourceId: string; headers: string[]; rows: GoogleSheetsCell[][]; mapping: MappingColumn[]; transformSettings: unknown;
  ownershipPolicy: 'FENCE_CROSS_SOURCE'; lease: { id: string; syncVersion: number; ttlMs: number };
}): Promise<CatalogueImportCounts> };
type CatalogueSyncNotifications = {
  catalogueSyncCompleted(tenantId: string, userId: string | null, counts: { createdRows: number; updatedRows: number }): Promise<void>;
  catalogueSyncFailed(tenantId: string, userId: string | null): Promise<void>;
};
const SOURCE_LEASE_MS = 5 * 60_000;
const SOURCE_HEARTBEAT_MS = 60_000;
const STALE_PROCESSING_MS = 10 * 60_000;
const SNAPSHOT_CONTENT_TYPE = 'application/vnd.autosale.catalogue-table+json';

export class GoogleCatalogueSyncProcessor {
  private readonly importer: TableImporter;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly sheets: Pick<GoogleSheetsAdapter, 'readTable'> | undefined,
    private readonly storage: Pick<ObjectStorage, 'put'>,
    importer?: TableImporter,
    private readonly oauthSheets?: (tenantId: string, connectionId: string) => Promise<Pick<GoogleSheetsAdapter, 'readTable'>>,
    private readonly notifications?: CatalogueSyncNotifications,
  ) {
    this.importer = importer ?? { importTable: (input) => importCatalogueTable(prisma, input) };
  }

  async process(input: { tenantId: string; sourceId: string }) {
    const source = await this.prisma.catalogueSource.findFirst({
      where: { id: input.sourceId, tenantId: input.tenantId, type: 'GOOGLE_SHEETS' },
      select: { id: true, createdByUserId: true, spreadsheetId: true, sheetName: true, credentialRef: true, syncSchedule: true, syncVersion: true, syncLeaseId: true, syncLeaseExpiresAt: true },
    });
    if (!source?.spreadsheetId || !source.sheetName) throw new Error('Google catalogue source is unavailable');
    const now = new Date();
    const leaseId = randomUUID();
    const claimed = await this.prisma.catalogueSource.updateMany({
      where: {
        id: input.sourceId, tenantId: input.tenantId, type: 'GOOGLE_SHEETS', syncVersion: source.syncVersion,
        OR: [{ syncLeaseId: null }, { syncLeaseExpiresAt: { lte: now } }],
      },
      data: { syncLeaseId: leaseId, syncLeaseExpiresAt: new Date(now.getTime() + SOURCE_LEASE_MS), syncVersion: { increment: 1 } },
    });
    if (claimed.count !== 1) return { status: 'BUSY' as const };
    const syncVersion = source.syncVersion + 1;
    const leaseWhere = { id: input.sourceId, tenantId: input.tenantId, type: 'GOOGLE_SHEETS' as const, syncLeaseId: leaseId, syncVersion };
    const heartbeat = this.startLeaseHeartbeat(leaseWhere);

    try {
    let table: Awaited<ReturnType<GoogleSheetsAdapter['readTable']>>;
    try {
      const sheets = source.credentialRef && this.oauthSheets
        ? await this.oauthSheets(input.tenantId, source.credentialRef)
        : this.sheets;
      if (!sheets) throw new GoogleOAuthAccessError();
      table = await sheets.readTable({ spreadsheetId: source.spreadsheetId, sheetName: source.sheetName, maxRows: 5_000 });
    } catch (error) {
      if (error instanceof GoogleSheetsTableValidationError) {
        await this.prisma.catalogueSource.updateMany({ where: leaseWhere, data: {
          status: 'PAUSED', lastErrorSummary: `TABLE_${error.code}`, syncLeaseId: null, syncLeaseExpiresAt: null,
        } });
        await this.notifyFailed(input.tenantId, source.createdByUserId);
        return { status: 'FAILED' as const, reason: 'TABLE_VALIDATION' as const, validationCode: error.code };
      }
      const failure = error instanceof GoogleSheetsReadError
        ? error
        : error instanceof GoogleOAuthAccessError
          ? new GoogleSheetsReadError('AUTHORIZATION', false)
          : new GoogleSheetsReadError('RETRYABLE', true);
      await this.prisma.catalogueSource.updateMany({ where: leaseWhere, data: {
        status: failure.code === 'AUTHORIZATION' ? 'DISCONNECTED' : 'ERROR', lastErrorSummary: failure.code,
        syncLeaseId: null, syncLeaseExpiresAt: null,
      } });
      await this.notifyFailed(input.tenantId, source.createdByUserId);
      throw failure;
    }

    const fingerprint = googleSheetsStructureFingerprint(table.headers);
    const mapping = await this.prisma.catalogueMapping.findFirst({
      where: { tenantId: input.tenantId, sourceId: input.sourceId, confirmedAt: { not: null } }, orderBy: { version: 'desc' },
      select: { id: true, version: true, sourceFingerprint: true, columns: true, transformSettings: true },
    });
    const columns = readMapping(mapping?.columns);
    const snapshotObjectKey = `catalogue/${input.tenantId}/${input.sourceId}/google/${table.revision}.json`;
    try {
      await this.storage.put({ key: snapshotObjectKey, contentType: SNAPSHOT_CONTENT_TYPE, body: Buffer.from(JSON.stringify({ headers: table.headers, rows: table.rows })) });
    } catch {
      await this.prisma.catalogueSource.updateMany({ where: leaseWhere, data: {
        status: 'ERROR', lastErrorSummary: 'SNAPSHOT_WRITE_FAILED', syncLeaseId: null, syncLeaseExpiresAt: null,
      } });
      await this.notifyFailed(input.tenantId, source.createdByUserId);
      throw new Error('Catalogue snapshot could not be stored');
    }

    if (!mapping || mapping.sourceFingerprint !== fingerprint) {
      return this.pauseForReview(input, table, snapshotObjectKey, fingerprint, leaseWhere, 'STRUCTURE_CHANGED');
    }
    if (!hasRequiredMapping(columns, table.headers)) {
      return this.pauseForReview(input, table, snapshotObjectKey, fingerprint, leaseWhere, 'MISSING_REQUIRED_COLUMNS');
    }

    const idempotencyKey = `google:${input.sourceId}:${table.revision}:mapping:${mapping.version}`;
    const existing = await this.prisma.catalogueImportRun.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey } },
      select: { id: true, status: true, mappingId: true, startedAt: true },
    });
    if (existing?.status === 'COMPLETED') {
      await this.releaseLease(leaseWhere, source.syncSchedule);
      return { status: 'NOOP' as const, revision: table.revision, runId: existing.id };
    }
    if (existing?.status === 'MAPPING_REVIEW') {
      await this.prisma.catalogueImportRun.updateMany({
        where: { id: existing.id, tenantId: input.tenantId, status: 'MAPPING_REVIEW' },
        data: { sourceSyncVersion: syncVersion, snapshotObjectKey, sourceHeaders: table.headers, totalRows: table.rows.length },
      });
      await this.releaseLease(leaseWhere, source.syncSchedule);
      return { status: 'MAPPING_REVIEW' as const, revision: table.revision, runId: existing.id };
    }
    if (existing?.status === 'PREVIEW_READY') {
      await this.prisma.catalogueImportRun.updateMany({
        where: { id: existing.id, tenantId: input.tenantId, status: 'PREVIEW_READY' },
        data: { sourceSyncVersion: syncVersion, snapshotObjectKey, sourceHeaders: table.headers, totalRows: table.rows.length },
      });
      await this.releaseLease(leaseWhere, source.syncSchedule);
      return { status: 'PREVIEW_READY' as const, revision: table.revision, runId: existing.id };
    }
    if (existing?.status === 'PROCESSING' && existing.startedAt && existing.startedAt.getTime() > now.getTime() - STALE_PROCESSING_MS) {
      await this.releaseLease(leaseWhere, source.syncSchedule);
      return { status: 'PROCESSING' as const, revision: table.revision, runId: existing.id };
    }

    let runId: string;
    if (existing && (existing.status === 'FAILED' || existing.status === 'PROCESSING')) {
      const recovered = await this.prisma.catalogueImportRun.updateMany({
        where: { id: existing.id, tenantId: input.tenantId, status: existing.status },
        data: {
          status: 'PROCESSING', mappingId: mapping.id, snapshotObjectKey, sourceHeaders: table.headers,
          sourceSyncVersion: syncVersion, startedAt: now, completedAt: null, rowErrors: [],
        },
      });
      if (recovered.count !== 1) { await this.releaseLease(leaseWhere, source.syncSchedule); return { status: 'BUSY' as const }; }
      runId = existing.id;
    } else {
      const run = await this.prisma.catalogueImportRun.create({ data: {
        tenantId: input.tenantId, sourceId: input.sourceId, mappingId: mapping.id, status: 'PROCESSING', idempotencyKey,
        sourceRevision: table.revision, sourceHeaders: table.headers, snapshotObjectKey, sourceSyncVersion: syncVersion,
        totalRows: table.rows.length, startedAt: now,
      } });
      runId = run.id;
    }

    try {
      await heartbeat.assertOwned();
      const result = await this.importer.importTable({
        tenantId: input.tenantId, sourceId: input.sourceId, headers: table.headers, rows: table.rows,
        mapping: columns, transformSettings: mapping.transformSettings, ownershipPolicy: 'FENCE_CROSS_SOURCE',
        lease: { id: leaseId, syncVersion, ttlMs: SOURCE_LEASE_MS },
      });
      await heartbeat.assertOwned();
      await this.prisma.$transaction(async (tx) => {
        const completedAt = new Date();
        const activated = await tx.catalogueSource.updateMany({ where: {
          ...leaseWhere, syncLeaseExpiresAt: { gt: completedAt },
        }, data: {
          status: 'ACTIVE', headerFingerprint: fingerprint, lastSyncedAt: completedAt, nextSyncAt: nextSyncAt(source.syncSchedule),
          lastErrorSummary: null, syncLeaseId: null, syncLeaseExpiresAt: null,
        } });
        if (activated.count !== 1) throw new CatalogueImportLeaseLostError();
        const completed = await tx.catalogueImportRun.updateMany({
          where: { id: runId, tenantId: input.tenantId, status: 'PROCESSING', sourceSyncVersion: syncVersion },
          data: { status: 'COMPLETED', ...result, rowErrors: result.rowErrors, completedAt },
        });
        if (completed.count !== 1) throw new CatalogueImportLeaseLostError();
      });
      await this.notifyCompleted(input.tenantId, source.createdByUserId, result);
      return { status: 'COMPLETED' as const, revision: table.revision, runId, ...result };
    } catch (error) {
      const collision = error instanceof CatalogueSkuOwnershipError;
      const leaseLost = error instanceof CatalogueImportLeaseLostError;
      await this.prisma.catalogueImportRun.updateMany({
        where: { id: runId, tenantId: input.tenantId, status: 'PROCESSING', sourceSyncVersion: syncVersion },
        data: {
          status: 'FAILED', rowErrors: [{ errors: [collision ? 'SKU_COLLISION' : leaseLost ? 'LEASE_LOST' : 'IMPORT_FAILED'] }], completedAt: new Date(),
          ...(collision ? { failedRows: table.rows.length } : {}),
        },
      });
      await this.prisma.catalogueSource.updateMany({ where: leaseWhere, data: {
        status: collision ? 'PAUSED' : 'ERROR', lastErrorSummary: collision ? 'SKU_COLLISION' : leaseLost ? 'LEASE_LOST' : 'IMPORT_FAILED',
        syncLeaseId: null, syncLeaseExpiresAt: null,
      } });
      await this.notifyFailed(input.tenantId, source.createdByUserId);
      if (collision) return { status: 'FAILED' as const, revision: table.revision, runId, reason: 'SKU_COLLISION' as const };
      throw new Error('Catalogue synchronization failed');
    }
    } finally {
      await heartbeat.stop();
      await this.releaseLease(leaseWhere, source.syncSchedule);
    }
  }

  private async notifyCompleted(tenantId: string, userId: string | null, result: CatalogueImportCounts): Promise<void> {
    try {
      await this.notifications?.catalogueSyncCompleted(tenantId, userId, {
        createdRows: result.createdRows,
        updatedRows: result.updatedRows,
      });
    } catch {
      // Synchronization remains authoritative when notification persistence fails.
    }
  }

  private async notifyFailed(tenantId: string, userId: string | null): Promise<void> {
    try {
      await this.notifications?.catalogueSyncFailed(tenantId, userId);
    } catch {
      // Synchronization remains authoritative when notification persistence fails.
    }
  }

  private startLeaseHeartbeat(leaseWhere: LeaseWhere) {
    let lost = false;
    let renewal = Promise.resolve();
    const renew = () => {
      renewal = renewal.then(async () => {
        const now = new Date();
        const result = await this.prisma.catalogueSource.updateMany({
          where: { ...leaseWhere, syncLeaseExpiresAt: { gt: now } },
          data: { syncLeaseExpiresAt: new Date(now.getTime() + SOURCE_LEASE_MS) },
        });
        if (result.count !== 1) lost = true;
      }).catch(() => { lost = true; });
    };
    const timer = setInterval(renew, SOURCE_HEARTBEAT_MS);
    timer.unref?.();
    return {
      assertOwned: async () => {
        await renewal;
        if (lost) throw new CatalogueImportLeaseLostError();
      },
      stop: async () => {
        clearInterval(timer);
        await renewal;
      },
    };
  }

  private async pauseForReview(
    input: { tenantId: string; sourceId: string }, table: { headers: string[]; rows: unknown[][]; revision: string }, snapshotObjectKey: string,
    fingerprint: string, leaseWhere: LeaseWhere, reason: 'STRUCTURE_CHANGED' | 'MISSING_REQUIRED_COLUMNS',
  ) {
    const idempotencyKey = `google:${input.sourceId}:${table.revision}:review`;
    const existing = await this.prisma.catalogueImportRun.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey } }, select: { id: true, status: true },
    });
    const run = existing ?? await this.prisma.catalogueImportRun.create({ data: {
      tenantId: input.tenantId, sourceId: input.sourceId, mappingId: null, status: 'UPLOADED', idempotencyKey,
      sourceRevision: table.revision, sourceHeaders: table.headers, snapshotObjectKey, sourceSyncVersion: leaseWhere.syncVersion,
      totalRows: table.rows.length, rowErrors: [{ errors: [reason] }],
    } });
    if (existing) {
      await this.prisma.catalogueImportRun.updateMany({
        where: { id: existing.id, tenantId: input.tenantId, status: { in: ['UPLOADED', 'MAPPING_REVIEW'] } },
        data: {
          sourceRevision: table.revision, sourceHeaders: table.headers, snapshotObjectKey, sourceSyncVersion: leaseWhere.syncVersion,
          totalRows: table.rows.length, rowErrors: [{ errors: [reason] }], status: 'UPLOADED', completedAt: null,
        },
      });
    }
    await this.prisma.catalogueSource.updateMany({ where: leaseWhere, data: {
      status: 'PAUSED', headerFingerprint: fingerprint, lastErrorSummary: reason, syncLeaseId: null, syncLeaseExpiresAt: null,
    } });
    return { status: 'MAPPING_REVIEW' as const, revision: table.revision, runId: run.id, reason };
  }

  private async releaseLease(leaseWhere: LeaseWhere, schedule: string | null) {
    await this.prisma.catalogueSource.updateMany({ where: leaseWhere, data: {
      nextSyncAt: nextSyncAt(schedule), syncLeaseId: null, syncLeaseExpiresAt: null,
    } });
  }
}

type LeaseWhere = { id: string; tenantId: string; type: 'GOOGLE_SHEETS'; syncLeaseId: string; syncVersion: number };
function readMapping(value: unknown): MappingColumn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => item && typeof item === 'object' && !Array.isArray(item)
    && typeof (item as Record<string, unknown>).source === 'string' && typeof (item as Record<string, unknown>).target === 'string'
    ? [{ source: normalizeHeader((item as Record<string, unknown>).source as string), target: (item as Record<string, unknown>).target as CatalogueTargetField }]
    : []);
}
function hasRequiredMapping(mapping: MappingColumn[], headers: string[]) { const available = new Set(headers.map(normalizeHeader)); return mapping.some((column) => column.target === 'name' && available.has(column.source)); }
function normalizeHeader(value: string) { return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'); }
function nextSyncAt(schedule: string | null): Date | null { const interval = schedule === 'HOURLY' ? 60 * 60_000 : schedule === 'DAILY' ? 24 * 60 * 60_000 : null; return interval === null ? null : new Date(Date.now() + interval); }

import type { PrismaClient } from '@autosale/database';
import { GoogleSheetsReadError, GoogleSheetsTableValidationError, googleSheetsStructureFingerprint, type GoogleSheetsAdapter } from '@autosale/integrations';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

export type CatalogueSyncSchedule = 'MANUAL' | 'HOURLY' | 'DAILY';

export type CatalogueSourceInput = {
  displayName: string;
  spreadsheet: string;
  sheetName: string;
  syncSchedule: CatalogueSyncSchedule;
};

type SourceRow = {
  id: string;
  type: string;
  displayName: string;
  status: string;
  spreadsheetId: string | null;
  sheetName: string | null;
  syncSchedule: string | null;
  lastSyncedAt: Date | null;
  lastErrorSummary: string | null;
  updatedAt: Date;
};

type CatalogueQueue = { add(name: string, data: { tenantId: string; sourceId: string }, options?: Record<string, unknown>): Promise<unknown> };
type OAuthCatalogueAccess = {
  verifySpreadsheet(tenantId: string, connectionId: string, spreadsheetId: string): Promise<{ tabs: Array<{ sheetId: number; title: string }> }>;
  sheetsForConnection(tenantId: string, connectionId: string): Promise<Pick<GoogleSheetsAdapter, 'readTable'>>;
};

export class CatalogueSourcesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sheets?: Pick<GoogleSheetsAdapter, 'readTable'>,
    private readonly queue?: CatalogueQueue,
    private readonly config: { serviceAccountEmail?: string; oauthRequired?: boolean } = {},
    private readonly oauth?: OAuthCatalogueAccess,
  ) {}

  async create(tenantId: string, userId: string, input: CatalogueSourceInput) {
    const spreadsheetId = parseGoogleSpreadsheetId(input.spreadsheet);
    const credentialRef = await this.verifyOAuthBinding(tenantId, spreadsheetId, input.sheetName);
    const source = await this.prisma.catalogueSource.create({
      data: {
        tenantId,
        createdByUserId: userId,
        type: 'GOOGLE_SHEETS',
        displayName: input.displayName,
        spreadsheetId,
        sheetName: input.sheetName,
        credentialRef,
        syncSchedule: input.syncSchedule,
        nextSyncAt: initialNextSyncAt(input.syncSchedule),
        status: 'PENDING',
      },
    });
    return this.ownerView(source, null);
  }

  async update(tenantId: string, sourceId: string, input: CatalogueSourceInput) {
    const spreadsheetId = parseGoogleSpreadsheetId(input.spreadsheet);
    const credentialRef = await this.verifyOAuthBinding(tenantId, spreadsheetId, input.sheetName);
    const now = new Date();
    const updated = await this.prisma.catalogueSource.updateMany({
      where: { id: sourceId, tenantId, type: 'GOOGLE_SHEETS', OR: [{ syncLeaseId: null }, { syncLeaseExpiresAt: { lte: now } }] },
      data: {
        displayName: input.displayName,
        spreadsheetId,
        sheetName: input.sheetName,
        credentialRef,
        syncSchedule: input.syncSchedule,
        nextSyncAt: initialNextSyncAt(input.syncSchedule),
        syncVersion: { increment: 1 },
        status: 'PENDING',
        lastErrorSummary: null,
      },
    });
    if (updated.count !== 1) {
      const exists = await this.prisma.catalogueSource.findFirst({ where: { id: sourceId, tenantId, type: 'GOOGLE_SHEETS' }, select: { id: true } });
      if (exists) throw new ConflictException('Catalogue source is synchronizing');
      throw new NotFoundException('Catalogue source not found');
    }
    return this.getConfiguration(tenantId, sourceId);
  }

  async remove(tenantId: string, sourceId: string) {
    try {
      const deleted = await this.prisma.catalogueSource.deleteMany({ where: { id: sourceId, tenantId, type: 'GOOGLE_SHEETS' } });
      if (deleted.count !== 1) throw new NotFoundException('Catalogue source not found');
      return { deleted: true as const };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new ConflictException('Catalogue source with imported products cannot be removed');
    }
  }

  async listHealth(tenantId: string) {
    const sources = await this.prisma.catalogueSource.findMany({
      where: { tenantId, type: 'GOOGLE_SHEETS' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, type: true, displayName: true, status: true,
        lastSyncedAt: true, lastErrorSummary: true, updatedAt: true,
      },
    });
    return sources.map(mapHealth);
  }

  async getConfiguration(tenantId: string, sourceId: string) {
    const source = await this.prisma.catalogueSource.findFirst({
      where: { id: sourceId, tenantId, type: 'GOOGLE_SHEETS' },
    });
    if (!source) throw new NotFoundException('Catalogue source not found');
    const latestRun = await this.prisma.catalogueImportRun.findFirst({
      where: { tenantId, sourceId }, orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, sourceHeaders: true },
    });
    const pendingReview = latestRun && ['MAPPING_REVIEW', 'PREVIEW_READY'].includes(latestRun.status)
      ? { runId: latestRun.id, headers: safeHeaders(latestRun.sourceHeaders) }
      : null;
    return this.ownerView(source, pendingReview);
  }

  async checkConnectivity(tenantId: string, sourceId: string) {
    const source = await this.prisma.catalogueSource.findFirst({
      where: { id: sourceId, tenantId, type: 'GOOGLE_SHEETS' },
      select: { id: true, spreadsheetId: true, sheetName: true, credentialRef: true },
    });
    if (!source) throw new NotFoundException('Catalogue source not found');
    if (!source.spreadsheetId || !source.sheetName) throw new BadRequestException('Google Sheets source is not configured');
    try {
      const sheets = source.credentialRef && this.oauth
        ? await this.oauth.sheetsForConnection(tenantId, source.credentialRef)
        : this.sheets;
      if (!sheets) throw new BadRequestException('Google connection is not configured');
      const table = await sheets.readTable({ spreadsheetId: source.spreadsheetId, sheetName: source.sheetName, maxRows: 5_000 });
      if (table.headers.length === 0 || table.headers.every((header) => !header.trim())) {
        await this.prisma.catalogueSource.updateMany({
          where: { id: sourceId, tenantId, type: 'GOOGLE_SHEETS' },
          data: { status: 'ERROR', lastErrorSummary: 'MISSING_HEADERS' },
        });
        throw new BadRequestException('Google sheet has no headers');
      }
      const fingerprint = googleSheetsStructureFingerprint(table.headers);
      await this.prisma.catalogueSource.updateMany({
        where: { id: sourceId, tenantId, type: 'GOOGLE_SHEETS' },
        data: { status: 'ACTIVE', headerFingerprint: fingerprint, lastErrorSummary: null },
      });
      return { connected: true, headers: table.headers, fingerprint };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof GoogleSheetsTableValidationError) {
        await this.prisma.catalogueSource.updateMany({
          where: { id: sourceId, tenantId, type: 'GOOGLE_SHEETS' },
          data: { status: 'PAUSED', lastErrorSummary: `TABLE_${error.code}` },
        });
        throw new BadRequestException('Google Sheets table structure is invalid');
      }
      const failure = error instanceof GoogleSheetsReadError ? error : new GoogleSheetsReadError('RETRYABLE', true);
      await this.prisma.catalogueSource.updateMany({
        where: { id: sourceId, tenantId, type: 'GOOGLE_SHEETS' },
        data: { status: failure.code === 'AUTHORIZATION' ? 'DISCONNECTED' : 'ERROR', lastErrorSummary: failure.code },
      });
      if (failure.retryable) throw new ServiceUnavailableException('Google Sheets is temporarily unavailable');
      throw new BadRequestException(failure.message);
    }
  }

  async synchronizeNow(tenantId: string, sourceId: string) {
    const source = await this.prisma.catalogueSource.findFirst({
      where: { id: sourceId, tenantId, type: 'GOOGLE_SHEETS' }, select: { id: true },
    });
    if (!source) throw new NotFoundException('Catalogue source not found');
    if (!this.queue) throw new ServiceUnavailableException('Catalogue synchronization is unavailable');
    try {
      await this.queue.add('catalogue.sync', { tenantId, sourceId }, {
        jobId: `catalogue.sync:${sourceId}`, attempts: 5, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: true, removeOnFail: true,
      });
      return { queued: true as const, sourceId };
    } catch {
      throw new ServiceUnavailableException('Catalogue synchronization is temporarily unavailable');
    }
  }

  private ownerView(source: SourceRow, pendingReview: { runId: string; headers: string[] } | null) {
    return {
      id: source.id,
      type: source.type,
      displayName: source.displayName,
      status: source.status,
      spreadsheetId: source.spreadsheetId,
      sheetName: source.sheetName,
      syncSchedule: source.syncSchedule ?? 'MANUAL',
      lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
      lastErrorSummary: source.lastErrorSummary,
      updatedAt: source.updatedAt.toISOString(),
      serviceAccountEmail: this.config.serviceAccountEmail ?? null,
      authorizationAction: this.config.oauthRequired
        ? 'CONNECTED_WITH_GOOGLE'
        : this.config.serviceAccountEmail ? 'SHARE_WITH_SERVICE_ACCOUNT' : 'CONFIGURE_SERVICE_ACCOUNT',
      pendingReview,
    };
  }

  private async verifyOAuthBinding(tenantId: string, spreadsheetId: string, sheetName: string): Promise<string | null> {
    if (!this.config.oauthRequired) return null;
    const connection = await this.prisma.googleConnection.findUnique({
      where: { tenantId },
      select: { id: true, status: true },
    });
    if (connection?.status !== 'ACTIVE' || !this.oauth) throw new BadRequestException('Connect Google before selecting a spreadsheet');
    const metadata = await this.oauth.verifySpreadsheet(tenantId, connection.id, spreadsheetId);
    if (!metadata.tabs.some((tab) => tab.title === sheetName)) throw new BadRequestException('Selected Google sheet tab is unavailable');
    return connection.id;
  }
}

function safeHeaders(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((header): header is string => typeof header === 'string').slice(0, 100) : [];
}

function initialNextSyncAt(schedule: CatalogueSyncSchedule): Date | null {
  return schedule === 'MANUAL' ? null : new Date();
}

function mapHealth(source: {
  id: string; type: string; displayName: string; status: string; lastSyncedAt: Date | null; lastErrorSummary: string | null; updatedAt: Date;
}) {
  return {
    id: source.id,
    type: source.type,
    displayName: source.displayName,
    status: source.status,
    lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
    lastErrorSummary: source.lastErrorSummary,
    updatedAt: source.updatedAt.toISOString(),
  };
}

export function parseGoogleSpreadsheetId(input: string): string {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{5,200}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') throw new Error('invalid host');
    const match = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{5,200})(?:\/|$)/);
    if (match?.[1]) return match[1];
  } catch {
    // The public error remains intentionally independent of URL parser details.
  }
  throw new BadRequestException('Invalid Google spreadsheet');
}

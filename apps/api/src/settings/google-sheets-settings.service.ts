import type { PrismaClient } from '@autosale/database';
import type { GoogleSheetsAdapter } from '@autosale/integrations';
import { BadRequestException } from '@nestjs/common';

const requiredHeaders = ['order_id', 'created_at', 'status', 'channel', 'conversation_id', 'customer_name', 'customer_phone', 'sku', 'product_name', 'quantity', 'delivery_city', 'delivery_branch', 'manager_note', 'confidence', 'updated_at'];
type OAuthDestinationAccess = {
  verifySpreadsheet(tenantId: string, connectionId: string, spreadsheetId: string): Promise<{ tabs: Array<{ sheetId: number; title: string }> }>;
  sheetsForConnection(tenantId: string, connectionId: string): Promise<Pick<GoogleSheetsAdapter, 'readHeader'>>;
};

export class GoogleSheetsSettingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sheets?: GoogleSheetsAdapter,
    private readonly config: { oauthRequired?: boolean } = {},
    private readonly oauth?: OAuthDestinationAccess,
  ) {}

  async get(tenantId: string) {
    const row = await this.prisma.googleSheetsDestination.findUnique({ where: { tenantId } });
    return row ? this.map(row) : { spreadsheetId: null, sheetName: 'Orders', status: 'NOT_CONFIGURED', requiredHeaders, lastValidatedAt: null, errorSummary: null };
  }

  async update(tenantId: string, input: { spreadsheetId: string; sheetName: string }) {
    const credentialRef = await this.verifyOAuthBinding(tenantId, input.spreadsheetId, input.sheetName);
    const row = await this.prisma.googleSheetsDestination.upsert({
      where: { tenantId },
      create: { tenantId, ...input, credentialRef, requiredHeaders, status: 'PENDING' },
      update: { ...input, credentialRef, requiredHeaders, status: 'PENDING', lastValidatedAt: null, errorSummary: null },
    });
    return this.map(row);
  }

  async validate(tenantId: string) {
    const destination = await this.prisma.googleSheetsDestination.findUnique({ where: { tenantId } });
    if (!destination) throw new BadRequestException('Google Sheets destination is not configured');
    try {
      const sheets = destination.credentialRef && this.oauth
        ? await this.oauth.sheetsForConnection(tenantId, destination.credentialRef)
        : this.sheets;
      if (!sheets) throw new BadRequestException('Google connection is not configured');
      const header = await sheets.readHeader({ spreadsheetId: destination.spreadsheetId, sheetName: destination.sheetName });
      const missingHeaders = requiredHeaders.filter((name) => !header.includes(name));
      const status = missingHeaders.length === 0 ? 'ACTIVE' : 'INVALID_HEADERS';
      await this.prisma.googleSheetsDestination.update({ where: { tenantId }, data: { status, lastValidatedAt: new Date(), errorSummary: missingHeaders.length ? `Missing headers: ${missingHeaders.join(', ')}` : null } });
      return { valid: missingHeaders.length === 0, missingHeaders, status };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const summary = error instanceof Error ? error.message : 'Google Sheets validation failed';
      await this.prisma.googleSheetsDestination.update({ where: { tenantId }, data: { status: 'ERROR', lastValidatedAt: new Date(), errorSummary: summary } });
      throw new BadRequestException(summary);
    }
  }

  private map(row: { spreadsheetId: string; sheetName: string; status: string; requiredHeaders: unknown; lastValidatedAt: Date | null; errorSummary: string | null }) {
    return { spreadsheetId: row.spreadsheetId, sheetName: row.sheetName, status: row.status, requiredHeaders: Array.isArray(row.requiredHeaders) ? row.requiredHeaders : requiredHeaders, lastValidatedAt: row.lastValidatedAt?.toISOString() ?? null, errorSummary: row.errorSummary };
  }

  private async verifyOAuthBinding(tenantId: string, spreadsheetId: string, sheetName: string): Promise<string | null> {
    if (!this.config.oauthRequired) return null;
    const connection = await this.prisma.googleConnection.findUnique({ where: { tenantId }, select: { id: true, status: true } });
    if (connection?.status !== 'ACTIVE' || !this.oauth) throw new BadRequestException('Connect Google before selecting a destination');
    const metadata = await this.oauth.verifySpreadsheet(tenantId, connection.id, spreadsheetId);
    if (!metadata.tabs.some((tab) => tab.title === sheetName)) throw new BadRequestException('Selected Google sheet tab is unavailable');
    return connection.id;
  }
}

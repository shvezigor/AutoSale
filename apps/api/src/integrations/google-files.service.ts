import { NotFoundException } from '@nestjs/common';

import type { GoogleFilesClientPort, VerifiedSpreadsheet } from './google-files.client.js';

export interface GoogleAccessTokenProvider {
  getAccessToken(tenantId: string): Promise<string>;
}

export class GoogleFilesService {
  constructor(
    private readonly tokens: GoogleAccessTokenProvider,
    private readonly files: GoogleFilesClientPort,
  ) {}

  async getTabs(tenantId: string, fileId: string): Promise<VerifiedSpreadsheet> {
    try {
      const accessToken = await this.tokens.getAccessToken(tenantId);
      return await this.files.inspectSpreadsheet(accessToken, fileId);
    } catch {
      throw new NotFoundException('Google spreadsheet is unavailable');
    }
  }
}

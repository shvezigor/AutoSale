import { BadRequestException, Body, Controller, Get, Inject, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthPrincipal } from '@autosale/contracts/auth';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { GoogleSheetsSettingsService } from './google-sheets-settings.service.js';

const destinationSchema = z.object({ spreadsheetId: z.string().trim().min(5).max(200), sheetName: z.string().trim().min(1).max(100) }).strict();

@ApiTags('settings')
@Controller('api/settings/google-sheets')
@RequireMembership('OWNER')
export class GoogleSheetsSettingsController {
  constructor(@Inject(GoogleSheetsSettingsService) private readonly settings: GoogleSheetsSettingsService) {}

  @Get() get(@CurrentPrincipal() principal: AuthPrincipal) { return this.settings.get(principal.tenantId!); }

  @Patch() update(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    const parsed = destinationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid Google Sheets destination');
    return this.settings.update(principal.tenantId!, parsed.data);
  }

  @Post('validate') validate(@CurrentPrincipal() principal: AuthPrincipal) { return this.settings.validate(principal.tenantId!); }
}

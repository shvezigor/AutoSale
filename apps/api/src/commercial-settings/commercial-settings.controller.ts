import type { AuthPrincipal } from '@autosale/contracts/auth';
import { bankAccountInputSchema, legalEntityInputSchema } from '@autosale/contracts/commercial';
import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { CommercialSettingsService } from './commercial-settings.service.js';

@Controller('api/settings')
@RequireMembership('MANAGER')
export class CommercialSettingsController {
  constructor(@Inject(CommercialSettingsService) private readonly settings: CommercialSettingsService) {}

  @Get('legal-entities')
  async legalEntities(@CurrentPrincipal() principal: AuthPrincipal) {
    return (await this.settings.list(principal.tenantId!)).legalEntities;
  }

  @Post('legal-entities')
  @RequireMembership('OWNER')
  createLegalEntity(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    const parsed = legalEntityInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid legal entity');
    return this.settings.createLegalEntity(principal.tenantId!, parsed.data);
  }

  @Patch('legal-entities/:id')
  @RequireMembership('OWNER')
  updateLegalEntity(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: unknown,
  ) {
    const parsed = legalEntityInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid legal entity');
    return this.settings.updateLegalEntity(principal.tenantId!, id, parsed.data);
  }

  @Get('bank-accounts')
  async bankAccounts(@CurrentPrincipal() principal: AuthPrincipal) {
    return (await this.settings.list(principal.tenantId!)).bankAccounts;
  }

  @Get('bank-accounts/:id')
  @RequireMembership('OWNER')
  accountDetail(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.settings.accountDetail(principal.tenantId!, id);
  }

  @Post('bank-accounts')
  @RequireMembership('OWNER')
  createBankAccount(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    const parsed = bankAccountInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid bank account');
    return this.settings.createBankAccount(principal.tenantId!, parsed.data);
  }

  @Patch('bank-accounts/:id')
  @RequireMembership('OWNER')
  updateBankAccount(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: unknown,
  ) {
    const parsed = bankAccountInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid bank account');
    return this.settings.updateBankAccount(principal.tenantId!, id, parsed.data);
  }
}

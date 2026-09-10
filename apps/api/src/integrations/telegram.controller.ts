import type { AuthPrincipal } from '@autosale/contracts/auth';
import { telegramLinkPurposeSchema, telegramNotificationPreferencesSchema, telegramSupplierSettingsUpdateSchema } from '@autosale/contracts';
import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { z } from 'zod';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { TelegramService } from './telegram.service.js';

const linkSchema = z.object({
  purpose: telegramLinkPurposeSchema,
  returnPath: z.string().max(2_048).optional(),
}).strict();

@Controller('api/integrations/telegram')
export class TelegramController {
  constructor(@Inject(TelegramService) private readonly telegram: TelegramService) {}

  @Get()
  @RequireMembership('MANAGER')
  summary(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.telegram.summary(principal.tenantId!, principal.userId);
  }

  @Post('link')
  @RequireMembership('MANAGER')
  link(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    const parsed = linkSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid Telegram link request');
    if (parsed.data.purpose === 'SUPPLIER_GROUP' && principal.membershipRole !== 'OWNER') {
      throw new ForbiddenException('Only workspace owners can link supplier groups');
    }
    return this.telegram.startLink(principal.tenantId!, principal.userId, parsed.data.purpose, parsed.data.returnPath);
  }

  @Delete('link')
  @RequireMembership('MANAGER')
  unlink(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.telegram.unlink(principal.tenantId!, principal.userId);
  }

  @Post('test')
  @RequireMembership('MANAGER')
  async test(@CurrentPrincipal() principal: AuthPrincipal) {
    try {
      return await this.telegram.queueTest(principal.tenantId!, principal.userId);
    } catch (error) {
      if (error instanceof Error && (
        error.message === 'Telegram personal connection required' ||
        error.message === 'Telegram is not configured'
      )) throw new BadRequestException('Telegram connection is unavailable');
      throw error;
    }
  }

  @Get('preferences')
  @RequireMembership('MANAGER')
  preferences(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.telegram.notificationPreferences(principal.tenantId!, principal.userId);
  }

  @Put('preferences')
  @RequireMembership('MANAGER')
  savePreferences(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    const parsed = telegramNotificationPreferencesSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid Telegram notification preferences');
    return this.telegram.saveNotificationPreferences(principal.tenantId!, principal.userId, parsed.data);
  }

  @Get('supplier')
  @RequireMembership('MANAGER')
  supplierSettings(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.telegram.supplierSettings(principal.tenantId!);
  }

  @Put('supplier')
  @RequireMembership('OWNER')
  saveSupplierSettings(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    if (principal.membershipRole !== 'OWNER') throw new ForbiddenException('Only workspace owners can configure suppliers');
    const parsed = telegramSupplierSettingsUpdateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid Telegram supplier settings');
    return this.telegram.saveSupplierSettings(principal.tenantId!, parsed.data);
  }

  @Post('supplier/orders/:id')
  @RequireMembership('MANAGER')
  async sendSupplierOrder(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    try {
      return await this.telegram.queueSupplierOrder(principal.tenantId!, id);
    } catch (error) {
      if (error instanceof Error && [
        'Approved order required', 'Telegram supplier destination required', 'Telegram is not configured',
      ].includes(error.message)) throw new BadRequestException(error.message);
      throw error;
    }
  }

  @Get('supplier/orders/:id/preview')
  @RequireMembership('MANAGER')
  async previewSupplierOrder(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    try {
      return await this.telegram.supplierOrderPreview(principal.tenantId!, id);
    } catch (error) {
      if (error instanceof Error && [
        'Approved order required', 'Telegram supplier destination required', 'No items require supplier ordering',
      ].includes(error.message)) throw new BadRequestException(error.message);
      throw error;
    }
  }
}

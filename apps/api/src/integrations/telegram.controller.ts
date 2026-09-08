import type { AuthPrincipal } from '@autosale/contracts/auth';
import { telegramLinkPurposeSchema } from '@autosale/contracts';
import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Inject, Post } from '@nestjs/common';
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
}

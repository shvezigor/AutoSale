import { conversionPlanIdSchema } from '@autosale/contracts';
import type { AuthPrincipal } from '@autosale/contracts/auth';
import { BadRequestException, Body, Controller, Header, Inject, Post } from '@nestjs/common';
import { z } from 'zod';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { ConversionService } from './conversion.service.js';

const inputSchema = z.object({ planId: conversionPlanIdSchema }).strict();

@Controller('api/conversion/plan-interest')
@RequireMembership('MANAGER')
export class TenantPlanInterestController {
  constructor(@Inject(ConversionService) private readonly conversions: ConversionService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  record(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('PLAN_INTEREST_INVALID');
    return this.conversions.recordPlanInterest(principal.tenantId!, parsed.data.planId);
  }
}

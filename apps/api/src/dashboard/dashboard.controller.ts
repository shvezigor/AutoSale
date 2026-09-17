import type { AuthPrincipal } from '@autosale/contracts/auth';
import { dashboardQuerySchema } from '@autosale/contracts/dashboard';
import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { DashboardService } from './dashboard.service.js';

@ApiTags('dashboard')
@Controller('api/dashboard')
@RequireMembership('MANAGER')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @Get()
  summary(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: unknown) {
    const parsed = dashboardQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid dashboard query');
    return this.dashboard.summary(principal.tenantId!, parsed.data.period);
  }
}

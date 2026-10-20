import type { AuthPrincipal } from '@autosale/contracts/auth';
import { adminDemoLeadListQuerySchema, adminDemoLeadStatusInputSchema } from '@autosale/contracts';
import { BadRequestException, Body, Controller, Get, Header, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';

import { CurrentPrincipal, RequirePlatformAdmin } from '../auth/auth.decorators.js';
import { AdminDemoLeadsService } from './admin-demo-leads.service.js';

@Controller('api/admin/demo-leads')
@RequirePlatformAdmin()
export class AdminDemoLeadsController {
  constructor(@Inject(AdminDemoLeadsService) private readonly leads: AdminDemoLeadsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query() query: unknown) {
    const input = adminDemoLeadListQuerySchema.safeParse(query);
    if (!input.success) throw new BadRequestException('DEMO_LEAD_LIST_INVALID');
    return this.leads.list(input.data);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async detail(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const lead = await this.leads.detail(id, principal.userId);
    if (!lead) throw new NotFoundException('DEMO_LEAD_NOT_FOUND');
    return lead;
  }

  @Patch(':id/status')
  @Header('Cache-Control', 'no-store')
  changeStatus(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: unknown,
  ) {
    const input = adminDemoLeadStatusInputSchema.safeParse(body);
    if (!input.success) throw new BadRequestException('DEMO_LEAD_STATUS_INVALID');
    return this.leads.changeStatus(id, input.data.status, input.data.expectedVersion, principal.userId);
  }
}

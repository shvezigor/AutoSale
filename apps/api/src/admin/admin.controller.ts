import { Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import { RequirePlatformAdmin } from '../auth/auth.decorators.js';
import { AdminService } from './admin.service.js';

@Controller('api/admin')
@RequirePlatformAdmin()
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get('tenants')
  listTenants() { return this.admin.listTenants(); }

  @Get('health-summary')
  healthSummary() { return { status: 'ok' as const }; }

  @Post('tenants/:id/block')
  async blockTenant(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const result = await this.admin.setTenantStatus(id, 'BLOCKED');
    if (!result) throw new NotFoundException('Tenant not found');
    return result;
  }

  @Post('tenants/:id/unblock')
  async unblockTenant(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const result = await this.admin.setTenantStatus(id, 'ACTIVE');
    if (!result) throw new NotFoundException('Tenant not found');
    return result;
  }
}

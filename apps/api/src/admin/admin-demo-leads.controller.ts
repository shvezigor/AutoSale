import type { AuthPrincipal } from '@autosale/contracts/auth';
import { adminDemoLeadCsvQuerySchema, adminDemoLeadListQuerySchema, adminDemoLeadStatusInputSchema } from '@autosale/contracts';
import { BadRequestException, Body, Controller, Get, Header, Headers, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, StreamableFile } from '@nestjs/common';
import { z } from 'zod';

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

  @Get('export.csv')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async exportCsv(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query() query: unknown,
    @Headers('x-admin-step-up') token: string | undefined,
  ): Promise<StreamableFile> {
    const parsed = adminDemoLeadCsvQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('DEMO_LEAD_EXPORT_FILTER_INVALID');
    const body = Buffer.from(await this.leads.exportCsv(parsed.data, principal.userId, principal.sessionId, token ?? ''), 'utf8');
    return new StreamableFile(body, { type: 'text/csv; charset=utf-8', disposition: 'attachment; filename="sales-aito-demo-leads.csv"', length: body.length });
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async detail(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const lead = await this.leads.detail(id, principal.userId);
    if (!lead) throw new NotFoundException('DEMO_LEAD_NOT_FOUND');
    return lead;
  }

  @Get(':id/export')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async exportOne(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('x-admin-step-up') token: string | undefined,
  ): Promise<StreamableFile> {
    const lead = await this.leads.exportOne(id, principal.userId, principal.sessionId, token ?? '');
    const body = Buffer.from(JSON.stringify(lead), 'utf8');
    return new StreamableFile(body, { type: 'application/json; charset=utf-8', disposition: `attachment; filename="sales-aito-demo-lead-${id}.json"`, length: body.length });
  }

  @Post(':id/delete')
  @Header('Cache-Control', 'no-store')
  deleteOne(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('x-admin-step-up') token: string | undefined,
    @Body() body: unknown,
  ) {
    const parsed = z.object({ confirmId: z.uuid() }).strict().safeParse(body);
    if (!parsed.success) throw new BadRequestException('DEMO_LEAD_CONFIRM_ID');
    return this.leads.deleteOne(id, parsed.data.confirmId, principal.userId, principal.sessionId, token ?? '');
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

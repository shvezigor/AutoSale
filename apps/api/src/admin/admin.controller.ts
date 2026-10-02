import type { AuthPrincipal } from '@autosale/contracts/auth';
import { adminReauthRequestSchema, lifecycleMutationRequestSchema } from '@autosale/contracts';
import { BadRequestException, Body, Controller, Get, Header, Headers, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query, StreamableFile } from '@nestjs/common';
import { z } from 'zod';

import { CurrentPrincipal, RequirePlatformAdmin } from '../auth/auth.decorators.js';
import { AdminService } from './admin.service.js';
import { AdminStepUpService } from './admin-step-up.service.js';
import { TenantLifecycleService } from './tenant-lifecycle.service.js';

const idempotencyKeySchema = z.string().uuid();
const retentionDryRunBodySchema = z.object({ tenantId: z.string().uuid() }).strict();

@Controller('api/admin')
@RequirePlatformAdmin()
export class AdminController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(AdminStepUpService) private readonly stepUp: AdminStepUpService,
    @Inject(TenantLifecycleService) private readonly lifecycle: TenantLifecycleService,
  ) {}

  @Get('tenants')
  listTenants() { return this.admin.listTenants(); }

  @Get('overview')
  overview() { return this.admin.getOverview(); }

  @Get('operations')
  operations() { return this.admin.getOperations(); }

  @Get('health-summary')
  async healthSummary() {
    const operations = await this.admin.getOperations();
    return { status: operations.status === 'HEALTHY' ? 'ok' as const : 'attention' as const };
  }

  @Get('tenants/:id')
  async tenant(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const tenant = await this.admin.getTenant(id);
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

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

  @Post('reauth')
  async reauthenticate(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    const parsed = adminReauthRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('ADMIN_REAUTH_INVALID');
    const stepUpToken = await this.stepUp.issue(
      principal.userId,
      principal.sessionId,
      parsed.data.currentPassword,
      parsed.data.purpose,
    );
    const expiresAt = this.stepUp.expiresAt(stepUpToken);
    if (!expiresAt) throw new BadRequestException('ADMIN_REAUTH_FAILED');
    return { stepUpToken, expiresAt };
  }

  @Get('tenant-lifecycle')
  listLifecycle(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.lifecycle.list(principal);
  }

  @Get('tenant-lifecycle/:requestId')
  lifecycleDetail(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string,
  ) {
    return this.lifecycle.detail(principal, requestId);
  }

  @Get('retention/dry-runs')
  listRetentionDryRuns(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query('tenantId', new ParseUUIDPipe({ version: '4' })) tenantId: string,
  ) {
    return this.lifecycle.listRetentionDryRuns(principal, tenantId);
  }

  @Post('retention/dry-runs')
  createRetentionDryRun(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const parsed = retentionDryRunBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('RETENTION_DRY_RUN_INVALID');
    return this.lifecycle.createRetentionDryRun(
      principal,
      parsed.data.tenantId,
      parseIdempotencyKey(rawIdempotencyKey),
    );
  }

  @Post('tenants/:tenantId/lifecycle-exports')
  createLifecycleExport(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('tenantId', new ParseUUIDPipe({ version: '4' })) tenantId: string,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.lifecycle.createExport(
      principal,
      tenantId,
      parseLifecycleBody(body),
      parseIdempotencyKey(rawIdempotencyKey),
    );
  }

  @Post('tenants/:tenantId/lifecycle-deletions')
  createLifecycleDeletion(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('tenantId', new ParseUUIDPipe({ version: '4' })) tenantId: string,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Headers('x-admin-step-up') stepUpToken: string | undefined,
    @Body() body: unknown,
  ) {
    return this.lifecycle.createDeletion(
      principal,
      tenantId,
      parseLifecycleBody(body),
      parseIdempotencyKey(rawIdempotencyKey),
      stepUpToken ?? '',
    );
  }

  @Post('tenant-lifecycle/:requestId/cancel')
  cancelLifecycle(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
  ) {
    parseIdempotencyKey(rawIdempotencyKey);
    return this.lifecycle.cancel(principal, requestId);
  }

  @Post('tenant-lifecycle/:requestId/retry')
  retryLifecycle(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
  ) {
    parseIdempotencyKey(rawIdempotencyKey);
    return this.lifecycle.retry(principal, requestId);
  }

  @Post('tenant-lifecycle/:requestId/download')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async downloadLifecycleExport(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Headers('x-admin-step-up') stepUpToken: string | undefined,
  ): Promise<StreamableFile> {
    parseIdempotencyKey(rawIdempotencyKey);
    const archive = await this.lifecycle.createDownload(principal, requestId, stepUpToken ?? '');
    return new StreamableFile(archive.body, {
      type: 'application/zip',
      disposition: `attachment; filename="${archive.filename}"`,
      length: archive.contentLength,
    });
  }
}

function parseLifecycleBody(body: unknown) {
  const parsed = lifecycleMutationRequestSchema.safeParse(body);
  if (!parsed.success) throw new BadRequestException('TENANT_LIFECYCLE_INVALID');
  return parsed.data;
}

function parseIdempotencyKey(value: string | undefined): string {
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('IDEMPOTENCY_KEY_INVALID');
  return parsed.data;
}

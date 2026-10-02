import { createHash } from 'node:crypto';

import type { AuthPrincipal } from '@autosale/contracts/auth';
import type { LifecycleMutationRequest, TenantLifecycleKind, TenantLifecycleRequest } from '@autosale/contracts';
import { Prisma, type PrismaClient, writeSecurityAudit, type SecurityAuditInput } from '@autosale/database';
import type { StoredObjectStream, StreamingObjectStorage } from '@autosale/integrations';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';

import type { AdminStepUpService } from './admin-step-up.service.js';

export type TenantLifecycleQueue = {
  add(
    name: string,
    data: { requestId: string; tenantId: string } | { runId: string; tenantId: string },
    options: Record<string, unknown>,
  ): Promise<unknown>;
};

type AuditWriter = (prisma: PrismaClient, input: SecurityAuditInput) => Promise<void>;

type LifecycleRow = {
  request_id: string;
  tenant_id: string;
  kind: TenantLifecycleKind;
  status: TenantLifecycleRequest['status'];
  reason_code: TenantLifecycleRequest['reasonCode'];
  ingestion_frozen_at: Date | null;
  export_object_key?: string | null;
  export_sha256?: string | null;
  export_size_bytes?: bigint | number | null;
  export_manifest_version?: number | null;
  export_ready_at?: Date | null;
  export_expires_at?: Date | null;
  last_error_code?: string | null;
  cancelled_at?: Date | null;
  requested_at: Date;
  replayed?: boolean;
};

type RetentionDryRunRow = {
  run_id: string;
  tenant_id: string;
  status: string;
  summary?: unknown;
  last_error_code?: string | null;
  completed_at?: Date | null;
  requested_at: Date;
  replayed?: boolean;
};

export type RetentionDryRunView = {
  id: string;
  tenantId: string;
  status: string;
  summary: Array<{
    category: string;
    policyStatus: string;
    cutoff: string | null;
    candidateCount: number | null;
    oldestCandidateAt: string | null;
    approximateBytes: number | null;
  }> | null;
  lastErrorCode: string | null;
  completedAt: string | null;
  requestedAt: string;
};

export class TenantLifecycleService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: TenantLifecycleQueue,
    private readonly stepUp: AdminStepUpService,
    private readonly audit: AuditWriter = writeSecurityAudit,
    private readonly now: () => Date = () => new Date(),
    private readonly storage?: Pick<StreamingObjectStorage, 'head' | 'getStream'>,
  ) {}

  async list(actor: AuthPrincipal): Promise<TenantLifecycleRequest[]> {
    const rows = await this.prisma.$queryRaw<LifecycleRow[]>(Prisma.sql`
      SELECT * FROM public.api_platform_tenant_lifecycle_requests(${actor.userId}::uuid)
    `);
    return rows.map(mapLifecycleRow);
  }

  async detail(actor: AuthPrincipal, requestId: string): Promise<TenantLifecycleRequest> {
    const rows = await this.prisma.$queryRaw<LifecycleRow[]>(Prisma.sql`
      SELECT * FROM public.api_platform_tenant_lifecycle_request(${actor.userId}::uuid, ${requestId}::uuid)
    `);
    if (!rows[0]) throw new NotFoundException('TENANT_LIFECYCLE_NOT_FOUND');
    return mapLifecycleRow(rows[0]);
  }

  async listRetentionDryRuns(actor: AuthPrincipal, tenantId: string): Promise<RetentionDryRunView[]> {
    const rows = await this.prisma.$queryRaw<RetentionDryRunRow[]>(Prisma.sql`
      SELECT * FROM public.api_platform_retention_dry_runs(${actor.userId}::uuid, ${tenantId}::uuid)
    `);
    return rows.slice(0, 50).map(mapRetentionDryRunRow);
  }

  async createRetentionDryRun(
    actor: AuthPrincipal,
    tenantId: string,
    idempotencyKey: string,
  ): Promise<RetentionDryRunView> {
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ tenantId, operation: 'RETENTION_DRY_RUN' }))
      .digest('hex');
    let rows: RetentionDryRunRow[];
    try {
      rows = await this.prisma.$queryRaw<RetentionDryRunRow[]>(Prisma.sql`
        SELECT * FROM public.api_platform_create_retention_dry_run(
          ${actor.userId}::uuid, ${tenantId}::uuid, ${idempotencyKey}::uuid, ${requestHash}, ${this.now()}
        )
      `);
    } catch (error) {
      if (containsCode(error, 'RETENTION_IDEMPOTENCY_CONFLICT')) {
        throw new ConflictException('RETENTION_IDEMPOTENCY_CONFLICT');
      }
      throw error;
    }
    const row = rows[0];
    if (!row) throw new NotFoundException('TENANT_NOT_FOUND');
    if (!row.replayed) {
      await this.queue.add('tenant-lifecycle.retention-dry-run', { runId: row.run_id, tenantId: row.tenant_id }, {
        jobId: `retention-dry-run-${row.run_id}`,
        attempts: 1,
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      });
      await this.writeAudit(actor, row.tenant_id, row.run_id, 'TENANT_RETENTION_DRY_RUN_REQUESTED', row.status);
    }
    return mapRetentionDryRunRow(row);
  }

  createExport(
    actor: AuthPrincipal,
    tenantId: string,
    input: LifecycleMutationRequest,
    idempotencyKey: string,
  ): Promise<TenantLifecycleRequest> {
    return this.create(actor, tenantId, 'EXPORT', input, idempotencyKey);
  }

  async createDeletion(
    actor: AuthPrincipal,
    tenantId: string,
    input: LifecycleMutationRequest,
    idempotencyKey: string,
    stepUpToken: string,
  ): Promise<TenantLifecycleRequest> {
    if (!this.stepUp.verify(stepUpToken, actor.userId, actor.sessionId, 'TENANT_DELETE_REQUEST')) {
      throw new UnauthorizedException('ADMIN_REAUTH_REQUIRED');
    }
    return this.create(actor, tenantId, 'DELETE', input, idempotencyKey);
  }

  async cancel(actor: AuthPrincipal, requestId: string): Promise<{ id: string; tenantId: string; status: string }> {
    const rows = await this.prisma.$queryRaw<Array<{ request_id: string; tenant_id: string; status: string }>>(Prisma.sql`
      SELECT * FROM public.api_platform_cancel_tenant_lifecycle_request(
        ${actor.userId}::uuid, ${requestId}::uuid, ${this.now()}
      )
    `);
    if (!rows[0]) throw new ConflictException('TENANT_LIFECYCLE_NOT_CANCELLABLE');
    await this.writeAudit(actor, rows[0].tenant_id, requestId, 'TENANT_LIFECYCLE_CANCELLED', rows[0].status);
    return { id: rows[0].request_id, tenantId: rows[0].tenant_id, status: rows[0].status };
  }

  async retry(actor: AuthPrincipal, requestId: string): Promise<{ id: string; tenantId: string; status: string }> {
    const rows = await this.prisma.$queryRaw<Array<{ request_id: string; tenant_id: string; status: string }>>(Prisma.sql`
      SELECT * FROM public.api_platform_retry_tenant_lifecycle_request(
        ${actor.userId}::uuid, ${requestId}::uuid, ${this.now()}
      )
    `);
    if (!rows[0]) throw new ConflictException('TENANT_LIFECYCLE_NOT_RETRYABLE');
    await this.queueRequest(rows[0].request_id, rows[0].tenant_id);
    await this.writeAudit(actor, rows[0].tenant_id, requestId, 'TENANT_LIFECYCLE_RETRIED', rows[0].status);
    return { id: rows[0].request_id, tenantId: rows[0].tenant_id, status: rows[0].status };
  }

  async createDownload(
    actor: AuthPrincipal,
    requestId: string,
    stepUpToken: string,
  ): Promise<{ body: StoredObjectStream['body']; contentLength: number; filename: string }> {
    if (!this.stepUp.verify(stepUpToken, actor.userId, actor.sessionId, 'TENANT_EXPORT_DOWNLOAD')) {
      throw new UnauthorizedException('ADMIN_REAUTH_REQUIRED');
    }
    if (!this.storage) throw new ConflictException('TENANT_LIFECYCLE_ARTIFACT_UNAVAILABLE');
    const rows = await this.prisma.$queryRaw<LifecycleRow[]>(Prisma.sql`
      SELECT * FROM public.api_platform_tenant_lifecycle_request(${actor.userId}::uuid, ${requestId}::uuid)
    `);
    const row = rows[0];
    if (!row) throw new NotFoundException('TENANT_LIFECYCLE_NOT_FOUND');
    if (row.status !== 'EXPORT_READY' || !row.export_object_key || !row.export_sha256
      || row.export_size_bytes === null || row.export_size_bytes === undefined) {
      throw new ConflictException('TENANT_LIFECYCLE_ARTIFACT_UNAVAILABLE');
    }
    const now = this.now();
    if (!row.export_expires_at || row.export_expires_at.getTime() <= now.getTime()) {
      throw new ConflictException('TENANT_LIFECYCLE_ARTIFACT_EXPIRED');
    }
    const head = await this.storage.head(row.export_object_key);
    if (head.contentType !== 'application/zip'
      || head.contentLength !== Number(row.export_size_bytes)
      || !head.checksumSha256
      || Buffer.from(head.checksumSha256, 'base64').toString('hex') !== row.export_sha256) {
      throw new ConflictException('TENANT_LIFECYCLE_ARTIFACT_VERIFICATION_FAILED');
    }
    const stored = await this.storage.getStream(row.export_object_key);
    if (stored.contentType !== 'application/zip' || stored.contentLength !== Number(row.export_size_bytes)) {
      throw new ConflictException('TENANT_LIFECYCLE_ARTIFACT_VERIFICATION_FAILED');
    }
    await this.writeAudit(actor, row.tenant_id, requestId, 'TENANT_LIFECYCLE_DOWNLOAD_ISSUED', row.status);
    return {
      body: stored.body,
      contentLength: stored.contentLength,
      filename: 'sales-aito-tenant-export.zip',
    };
  }

  private async create(
    actor: AuthPrincipal,
    tenantId: string,
    kind: TenantLifecycleKind,
    input: LifecycleMutationRequest,
    idempotencyKey: string,
  ): Promise<TenantLifecycleRequest> {
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ tenantId, kind, reasonCode: input.reasonCode }))
      .digest('hex');
    let rows: LifecycleRow[];
    try {
      rows = await this.prisma.$queryRaw<LifecycleRow[]>(Prisma.sql`
        SELECT * FROM public.api_platform_create_tenant_lifecycle_request(
          ${actor.userId}::uuid, ${tenantId}::uuid, ${kind}, ${input.reasonCode},
          ${idempotencyKey}::uuid, ${requestHash}, ${this.now()}
        )
      `);
    } catch (error) {
      if (containsCode(error, 'LIFECYCLE_IDEMPOTENCY_CONFLICT')) {
        throw new ConflictException('LIFECYCLE_IDEMPOTENCY_CONFLICT');
      }
      throw error;
    }
    const row = rows[0];
    if (!row) throw new NotFoundException('TENANT_NOT_FOUND');
    if (!row.replayed) {
      await this.queueRequest(row.request_id, row.tenant_id);
      await this.writeAudit(
        actor,
        row.tenant_id,
        row.request_id,
        kind === 'DELETE' ? 'TENANT_LIFECYCLE_DELETE_REQUESTED' : 'TENANT_LIFECYCLE_EXPORT_REQUESTED',
        row.status,
        input.reasonCode,
      );
    }
    return mapLifecycleRow(row);
  }

  private queueRequest(requestId: string, tenantId: string): Promise<unknown> {
    return this.queue.add('tenant-lifecycle.export', { requestId, tenantId }, {
      jobId: `tenant-lifecycle-${requestId}-${Math.floor(this.now().getTime() / 5_000)}`,
      attempts: 1,
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    });
  }

  private writeAudit(
    actor: AuthPrincipal,
    tenantId: string,
    requestId: string,
    action: string,
    status: string,
    reasonCode?: string,
  ): Promise<void> {
    return this.audit(this.prisma, {
      tenantId: null,
      userId: actor.userId,
      actor: 'USER',
      action,
      result: 'SUCCESS',
      metadata: { tenantId, requestId, status, ...(reasonCode ? { reasonCode } : {}) },
    });
  }
}

function mapLifecycleRow(row: LifecycleRow): TenantLifecycleRequest {
  return {
    id: row.request_id,
    tenantId: row.tenant_id,
    kind: row.kind,
    status: row.status,
    reasonCode: row.reason_code,
    requestedAt: row.requested_at.toISOString(),
    ingestionFrozenAt: row.ingestion_frozen_at?.toISOString() ?? null,
    exportSha256: row.export_sha256 ?? null,
    exportSizeBytes: row.export_size_bytes === null || row.export_size_bytes === undefined
      ? null
      : Number(row.export_size_bytes),
    exportManifestVersion: row.export_manifest_version ?? null,
    exportReadyAt: row.export_ready_at?.toISOString() ?? null,
    exportExpiresAt: row.export_expires_at?.toISOString() ?? null,
    lastErrorCode: row.last_error_code ?? null,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
  };
}

function mapRetentionDryRunRow(row: RetentionDryRunRow): RetentionDryRunView {
  return {
    id: row.run_id,
    tenantId: row.tenant_id,
    status: row.status,
    summary: safeRetentionSummary(row.summary),
    lastErrorCode: row.last_error_code ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    requestedAt: row.requested_at.toISOString(),
  };
}

function safeRetentionSummary(value: unknown): RetentionDryRunView['summary'] {
  if (!Array.isArray(value)) return null;
  return value.slice(0, 20).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.category !== 'string' || typeof item.policyStatus !== 'string') return [];
    return [{
      category: item.category.slice(0, 80),
      policyStatus: item.policyStatus.slice(0, 40),
      cutoff: typeof item.cutoff === 'string' ? item.cutoff : null,
      candidateCount: typeof item.candidateCount === 'number' && Number.isSafeInteger(item.candidateCount) ? item.candidateCount : null,
      oldestCandidateAt: typeof item.oldestCandidateAt === 'string' ? item.oldestCandidateAt : null,
      approximateBytes: typeof item.approximateBytes === 'number' && Number.isSafeInteger(item.approximateBytes) ? item.approximateBytes : null,
    }];
  });
}

function containsCode(error: unknown, code: string): boolean {
  if (!(error instanceof Error)) return false;
  const meta = (error as Error & { meta?: { message?: unknown } }).meta;
  const metaMessage = typeof meta?.message === 'string' ? meta.message : '';
  return error.message.includes(code) || metaMessage.includes(code);
}

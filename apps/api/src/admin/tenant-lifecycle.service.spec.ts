import type { AuthPrincipal } from '@autosale/contracts/auth';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { TenantLifecycleService } from './tenant-lifecycle.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const idempotencyKey = '33333333-3333-4333-8333-333333333333';
const principal: AuthPrincipal = {
  userId: '44444444-4444-4444-8444-444444444444', email: 'admin@example.test', name: 'Fictional Admin',
  platformRole: 'PLATFORM_ADMIN', tenantId: null, membershipRole: null, locale: 'uk', avatarUrl: null,
  sessionId: '55555555-5555-4555-8555-555555555555',
};

const createdRow = {
  request_id: requestId, tenant_id: tenantId, kind: 'DELETE', status: 'REQUESTED',
  reason_code: 'ADMINISTRATIVE_TEST', ingestion_frozen_at: new Date('2026-10-02T09:00:00Z'),
  requested_at: new Date('2026-10-02T09:00:00Z'), replayed: false,
};

describe('TenantLifecycleService', () => {
  it('requires a valid session-bound step-up token for deletion preparation', async () => {
    const stepUp = { verify: vi.fn().mockReturnValue(false) };
    const service = new TenantLifecycleService({} as never, { add: vi.fn() } as never, stepUp as never, vi.fn());

    await expect(service.createDeletion(
      principal, tenantId, { reasonCode: 'ADMINISTRATIVE_TEST' }, idempotencyKey, 'invalid-token',
    )).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('creates, audits and enqueues a deletion export exactly once', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([createdRow]) };
    const queue = { add: vi.fn().mockResolvedValue(undefined) };
    const audit = vi.fn().mockResolvedValue(undefined);
    const stepUp = { verify: vi.fn().mockReturnValue(true) };
    const service = new TenantLifecycleService(prisma as never, queue, stepUp as never, audit);

    await expect(service.createDeletion(
      principal, tenantId, { reasonCode: 'ADMINISTRATIVE_TEST' }, idempotencyKey, 'valid-token',
    )).resolves.toEqual(expect.objectContaining({ id: requestId, tenantId, kind: 'DELETE', status: 'REQUESTED' }));
    expect(queue.add).toHaveBeenCalledWith('tenant-lifecycle.export', { requestId, tenantId }, expect.objectContaining({
      jobId: expect.stringMatching(new RegExp(`^tenant-lifecycle-${requestId}-`)),
    }));
    expect(audit).toHaveBeenCalledWith(prisma, expect.objectContaining({
      tenantId: null, userId: principal.userId, action: 'TENANT_LIFECYCLE_DELETE_REQUESTED', result: 'SUCCESS',
    }));
  });

  it('does not enqueue an idempotent replay', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ ...createdRow, replayed: true }]) };
    const queue = { add: vi.fn() };
    const service = new TenantLifecycleService(
      prisma as never, queue, { verify: vi.fn().mockReturnValue(true) } as never, vi.fn().mockResolvedValue(undefined),
    );

    await service.createDeletion(principal, tenantId, { reasonCode: 'ADMINISTRATIVE_TEST' }, idempotencyKey, 'token');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('maps an idempotency conflict to a safe HTTP conflict', async () => {
    const prisma = { $queryRaw: vi.fn().mockRejectedValue(Object.assign(new Error('unsafe database details'), {
      code: 'P2010', meta: { message: 'LIFECYCLE_IDEMPOTENCY_CONFLICT' },
    })) };
    const service = new TenantLifecycleService(
      prisma as never, { add: vi.fn() } as never, { verify: vi.fn().mockReturnValue(true) } as never, vi.fn(),
    );

    await expect(service.createDeletion(
      principal, tenantId, { reasonCode: 'ADMINISTRATIVE_TEST' }, idempotencyKey, 'token',
    )).rejects.toEqual(expect.objectContaining<Partial<ConflictException>>({ message: 'LIFECYCLE_IDEMPOTENCY_CONFLICT' }));
  });

  it('issues a five-minute download only after metadata verification and safe audit', async () => {
    const checksum = 'c'.repeat(64);
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{
      request_id: requestId, tenant_id: tenantId, kind: 'EXPORT', status: 'EXPORT_READY', reason_code: 'ADMINISTRATIVE_TEST',
      ingestion_frozen_at: null, export_object_key: 'tenant-lifecycle/private/export.zip', export_sha256: checksum,
      export_size_bytes: 42n, export_manifest_version: 1, export_ready_at: new Date('2026-10-02T09:00:00Z'),
      export_expires_at: new Date('2026-10-09T09:00:00Z'), last_error_code: null, cancelled_at: null,
      requested_at: new Date('2026-10-02T08:59:00Z'),
    }]) };
    const storage = {
      head: vi.fn().mockResolvedValue({ contentLength: 42, contentType: 'application/zip', checksumSha256: Buffer.from(checksum, 'hex').toString('base64') }),
      createSignedDownloadUrl: vi.fn().mockResolvedValue('https://objects.example.test/download?fictional-signature'),
    };
    const audit = vi.fn().mockResolvedValue(undefined);
    const stepUp = { verify: vi.fn().mockReturnValue(true) };
    const now = () => new Date('2026-10-02T09:01:00Z');
    const service = new TenantLifecycleService(prisma as never, { add: vi.fn() } as never, stepUp as never, audit, now, storage as never);

    await expect(service.createDownload(principal, requestId, 'valid-download-step-up')).resolves.toEqual({
      url: 'https://objects.example.test/download?fictional-signature',
      expiresAt: '2026-10-02T09:06:00.000Z',
    });
    expect(audit).toHaveBeenCalledWith(prisma, expect.objectContaining({
      action: 'TENANT_LIFECYCLE_DOWNLOAD_ISSUED',
      metadata: expect.not.objectContaining({ url: expect.anything(), objectKey: expect.anything() }),
    }));
  });

  it('does not sign an expired lifecycle artifact', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{
      request_id: requestId, tenant_id: tenantId, kind: 'EXPORT', status: 'EXPORT_READY', reason_code: 'ADMINISTRATIVE_TEST',
      ingestion_frozen_at: null, export_object_key: 'tenant-lifecycle/private/expired.zip', export_sha256: 'e'.repeat(64),
      export_size_bytes: 42n, export_manifest_version: 1, export_ready_at: new Date('2026-09-25T09:00:00Z'),
      export_expires_at: new Date('2026-10-02T09:00:00Z'), requested_at: new Date('2026-09-25T08:59:00Z'),
    }]) };
    const storage = { head: vi.fn(), createSignedDownloadUrl: vi.fn() };
    const service = new TenantLifecycleService(
      prisma as never,
      { add: vi.fn() } as never,
      { verify: vi.fn().mockReturnValue(true) } as never,
      vi.fn(),
      () => new Date('2026-10-02T09:01:00Z'),
      storage as never,
    );

    await expect(service.createDownload(principal, requestId, 'valid-download-step-up'))
      .rejects.toThrow('TENANT_LIFECYCLE_ARTIFACT_EXPIRED');
    expect(storage.head).not.toHaveBeenCalled();
    expect(storage.createSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('creates, audits and enqueues a retention dry-run exactly once', async () => {
    const row = {
      run_id: requestId, tenant_id: tenantId, status: 'REQUESTED', summary: null,
      last_error_code: null, completed_at: null, requested_at: new Date('2026-10-02T09:00:00Z'), replayed: false,
    };
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([row]) };
    const queue = { add: vi.fn().mockResolvedValue(undefined) };
    const audit = vi.fn().mockResolvedValue(undefined);
    const service = new TenantLifecycleService(prisma as never, queue, {} as never, audit);

    await expect(service.createRetentionDryRun(principal, tenantId, idempotencyKey)).resolves.toEqual({
      id: requestId, tenantId, status: 'REQUESTED', summary: null, lastErrorCode: null,
      completedAt: null, requestedAt: '2026-10-02T09:00:00.000Z',
    });
    expect(queue.add).toHaveBeenCalledWith(
      'tenant-lifecycle.retention-dry-run', { runId: requestId, tenantId },
      expect.objectContaining({ jobId: `retention-dry-run-${requestId}`, attempts: 1 }),
    );
    expect(audit).toHaveBeenCalledWith(prisma, expect.objectContaining({
      action: 'TENANT_RETENTION_DRY_RUN_REQUESTED', result: 'SUCCESS',
    }));
  });

  it('returns only bounded safe retention summary fields', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{
      run_id: requestId, tenant_id: tenantId, status: 'COMPLETED', requested_at: new Date('2026-10-02T09:00:00Z'),
      completed_at: new Date('2026-10-02T09:01:00Z'), last_error_code: null,
      summary: [{
        category: 'RAW_WEBHOOKS', policyStatus: 'DRY_RUN_ONLY', cutoff: '2026-09-02T09:00:00.000Z',
        candidateCount: 4, oldestCandidateAt: '2026-01-01T00:00:00.000Z', approximateBytes: null,
        customerMessage: 'must not leave storage',
      }],
    }]) };
    const service = new TenantLifecycleService(prisma as never, { add: vi.fn() } as never, {} as never, vi.fn());

    const result = await service.listRetentionDryRuns(principal, tenantId);
    expect(result[0]?.summary).toEqual([{
      category: 'RAW_WEBHOOKS', policyStatus: 'DRY_RUN_ONLY', cutoff: '2026-09-02T09:00:00.000Z',
      candidateCount: 4, oldestCandidateAt: '2026-01-01T00:00:00.000Z', approximateBytes: null,
    }]);
    expect(JSON.stringify(result)).not.toContain('must not leave storage');
  });
});

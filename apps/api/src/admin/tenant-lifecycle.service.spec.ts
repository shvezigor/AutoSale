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
      jobId: `tenant-lifecycle:${requestId}`,
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
});

import { describe, expect, it } from 'vitest';

import {
  createTenantLifecycleRequestSchema,
  retentionDryRunJobSchema,
  tenantLifecycleJobSchema,
  tenantLifecycleRequestSchema,
} from './tenant-lifecycle.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const idempotencyKey = '33333333-3333-4333-8333-333333333333';

describe('tenant lifecycle contracts', () => {
  it('accepts a deletion preparation request with a bounded reason', () => {
    expect(createTenantLifecycleRequestSchema.parse({
      kind: 'DELETE',
      reasonCode: 'CONTROLLER_REQUEST',
      idempotencyKey,
    })).toEqual({ kind: 'DELETE', reasonCode: 'CONTROLLER_REQUEST', idempotencyKey });
  });

  it('rejects unsupported reasons and unrecognized fields', () => {
    expect(createTenantLifecycleRequestSchema.safeParse({
      kind: 'DELETE',
      reasonCode: 'FREE_TEXT_REASON',
      idempotencyKey,
      note: 'customer content must not be accepted',
    }).success).toBe(false);
  });

  it('parses only routing identifiers from lifecycle and retention jobs', () => {
    expect(tenantLifecycleJobSchema.parse({ tenantId, requestId })).toEqual({ tenantId, requestId });
    expect(retentionDryRunJobSchema.parse({ tenantId, runId: requestId })).toEqual({ tenantId, runId: requestId });
  });

  it('serializes a safe lifecycle response without secrets or signed URLs', () => {
    const parsed = tenantLifecycleRequestSchema.parse({
      id: requestId,
      tenantId,
      kind: 'EXPORT',
      status: 'EXPORT_READY',
      reasonCode: 'ADMINISTRATIVE_TEST',
      requestedAt: '2026-10-02T09:00:00.000Z',
      ingestionFrozenAt: null,
      exportSha256: 'a'.repeat(64),
      exportSizeBytes: 42,
      exportManifestVersion: 1,
      exportReadyAt: '2026-10-02T09:01:00.000Z',
      exportExpiresAt: '2026-10-09T09:01:00.000Z',
      lastErrorCode: null,
      cancelledAt: null,
    });

    expect(parsed).not.toHaveProperty('exportObjectKey');
    expect(parsed).not.toHaveProperty('signedUrl');
  });
});

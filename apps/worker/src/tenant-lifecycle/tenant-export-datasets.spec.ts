import { describe, expect, it, vi } from 'vitest';

import { TENANT_EXPORT_DATASETS } from './tenant-export-datasets.js';

describe('tenant export dataset allowlist', () => {
  it('contains merchant data but excludes secret-bearing persistence categories', () => {
    const names = TENANT_EXPORT_DATASETS.map((dataset) => dataset.name);
    expect(names).toContain('instagram-connections');
    expect(names).toContain('memberships');
    expect(names).not.toContain('sessions');
    expect(names).not.toContain('password-reset-tokens');
    expect(names).not.toContain('oauth-states');

    const fields = TENANT_EXPORT_DATASETS.flatMap((dataset) => dataset.fields);
    for (const prohibited of [
      'passwordHash', 'tokenHash', 'encryptedAccessToken', 'encryptedRefreshToken',
      'encryptedCredential', 'leaseId', 'requestHash', 'idempotencyKey',
    ]) expect(fields).not.toContain(prohibited);
  });

  it('selects only public Instagram connection metadata', async () => {
    const findMany = vi.fn().mockResolvedValue([{
      id: 'connection-id', tenantId: 'tenant-id', externalAccountId: '17841400000000000',
      displayName: 'Fictional shop', status: 'ACTIVE', lastVerifiedAt: null,
      lastErrorCode: null, disconnectedAt: null, createdAt: new Date('2026-10-02T09:00:00Z'),
      updatedAt: new Date('2026-10-02T09:00:00Z'),
    }]);
    const dataset = TENANT_EXPORT_DATASETS.find((candidate) => candidate.name === 'instagram-connections')!;

    const rows = await dataset.page({ instagramConnection: { findMany } } as never, 'tenant-id', null, 500);

    expect(rows[0]).not.toHaveProperty('encryptedAccessToken');
    expect(rows[0]).not.toHaveProperty('credentialGenerationId');
    expect(findMany.mock.calls[0]![0].select).not.toHaveProperty('encryptedAccessToken');
  });
});

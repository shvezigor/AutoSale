import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import { CredentialCipher } from './credential-cipher.js';
import { GoogleCredentialCleanupService } from './google-credential-cleanup.service.js';

describe('GoogleCredentialCleanupService', () => {
  it('blocks dependent jobs before revoking and removes only the matching credential generation', async () => {
    const cipher = new CredentialCipher(Buffer.alloc(32, 4));
    const transaction = {
      googleConnection: {
        findUnique: vi.fn().mockResolvedValue({ credentialGenerationId: 'generation-a', encryptedRefreshToken: cipher.encrypt('refresh-a') }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      googleCredentialCleanup: {
        upsert: vi.fn().mockResolvedValue({ id: 'cleanup-a', tenantId: 'tenant-a', credentialGenerationId: 'generation-a', encryptedRefreshToken: cipher.encrypt('refresh-a') }),
        update: vi.fn().mockResolvedValue({}),
      },
      catalogueSource: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      googleSheetsDestination: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = { ...transaction, $transaction: async (callback: any) => callback(transaction) };
    const client = { revokeRefreshToken: vi.fn().mockResolvedValue(undefined) };
    const service = new GoogleCredentialCleanupService(prisma as never, client, cipher);

    await service.disconnect('tenant-a', 'user-a');

    expect(transaction.catalogueSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a', type: 'GOOGLE_SHEETS' } }));
    expect(client.revokeRefreshToken).toHaveBeenCalledWith('refresh-a');
    expect(transaction.googleConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a', credentialGenerationId: 'generation-a' } }));
  });

  it('keeps failed revocation retryable without clearing local credentials', async () => {
    const cipher = new CredentialCipher(Buffer.alloc(32, 4));
    const row = { id: 'cleanup-a', tenantId: 'tenant-a', credentialGenerationId: 'generation-a', encryptedRefreshToken: cipher.encrypt('refresh-a') };
    const transaction = {
      googleConnection: { findUnique: vi.fn().mockResolvedValue({ credentialGenerationId: row.credentialGenerationId, encryptedRefreshToken: row.encryptedRefreshToken }), update: vi.fn(), updateMany: vi.fn() },
      googleCredentialCleanup: { upsert: vi.fn().mockResolvedValue(row), update: vi.fn().mockResolvedValue({}) },
      catalogueSource: { updateMany: vi.fn() },
      googleSheetsDestination: { updateMany: vi.fn() },
    };
    const prisma = { ...transaction, $transaction: async (callback: any) => callback(transaction) };
    const service = new GoogleCredentialCleanupService(prisma as never, { revokeRefreshToken: vi.fn().mockRejectedValue(new Error('network')) }, cipher);

    await expect(service.disconnect('tenant-a', 'user-a')).resolves.toEqual({ status: 'DISCONNECTING' });

    expect(transaction.googleCredentialCleanup.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
    expect(transaction.googleConnection.updateMany).not.toHaveBeenCalled();
  });

  it('reconciles a bounded batch of persisted cleanup failures', async () => {
    const cipher = new CredentialCipher(Buffer.alloc(32, 4));
    const row = {
      id: 'cleanup-a',
      tenantId: 'tenant-a',
      credentialGenerationId: 'generation-a',
      encryptedRefreshToken: cipher.encrypt('refresh-a'),
    };
    const transaction = {
      googleConnection: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      googleCredentialCleanup: { update: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      ...transaction,
      googleCredentialCleanup: {
        ...transaction.googleCredentialCleanup,
        findMany: vi.fn().mockResolvedValue([row]),
      },
      $transaction: async (callback: any) => callback(transaction),
    };
    const client = { revokeRefreshToken: vi.fn().mockResolvedValue(undefined) };
    const service = new GoogleCredentialCleanupService(prisma as never, client, cipher);

    await expect(service.reconcilePending(5)).resolves.toEqual({ attempted: 1, completed: 1 });

    expect(prisma.googleCredentialCleanup.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
    expect(transaction.googleConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a', credentialGenerationId: 'generation-a' },
    }));
  });
});

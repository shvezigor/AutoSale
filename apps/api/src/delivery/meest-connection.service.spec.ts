import { describe, expect, it, vi } from 'vitest';

import { MeestConnectionService } from './meest-connection.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-09-12T08:00:00.000Z');
const input = { login: 'merchant', password: 'secret-password', clientUid: '8458f0b0-930f-11e2-a91e-003048d2b473' };

function fixture() {
  const connection = {
    id: '33333333-3333-4333-8333-333333333333', tenantId, provider: 'MEEST', status: 'ACTIVE',
    encryptedCredential: 'ciphertext', credentialGenerationId: '44444444-4444-4444-8444-444444444444',
    accountLabel: 'merchant', connectedByUserId: userId, lastVerifiedAt: now, lastErrorCode: null,
    disconnectedAt: null, createdAt: now, updatedAt: now, senderProfile: null,
  };
  const prisma = { deliveryConnection: {
    findUnique: vi.fn().mockResolvedValue(connection),
    upsert: vi.fn().mockResolvedValue(connection),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  } };
  const cipher = { encrypt: vi.fn().mockReturnValue('ciphertext') };
  const validateCredential = vi.fn().mockResolvedValue({ valid: true, accountLabel: 'merchant' });
  const factory = vi.fn().mockReturnValue({ validateCredential });
  const service = new MeestConnectionService(prisma as never, cipher as never, factory, { enabled: true, now: () => now });
  return { service, prisma, cipher, factory, validateCredential };
}

describe('MeestConnectionService', () => {
  it('returns only a safe tenant-scoped summary', async () => {
    const { service, prisma } = fixture();
    await expect(service.summary(tenantId)).resolves.toMatchObject({
      enabled: true,
      connection: { provider: 'MEEST', status: 'ACTIVE', accountLabel: 'merchant', senderProfile: null },
    });
    expect(prisma.deliveryConnection.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_provider: { tenantId, provider: 'MEEST' } },
    }));
    expect(JSON.stringify(await service.summary(tenantId))).not.toMatch(/password|ciphertext|encryptedCredential/i);
  });

  it('validates before encrypting and persists all credentials as one encrypted document', async () => {
    const { service, prisma, cipher, factory, validateCredential } = fixture();
    await service.connect(tenantId, userId, input);
    expect(factory).toHaveBeenCalledWith(input);
    expect(validateCredential).toHaveBeenCalledOnce();
    expect(cipher.encrypt).toHaveBeenCalledWith(JSON.stringify(input));
    expect(prisma.deliveryConnection.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_provider: { tenantId, provider: 'MEEST' } },
      create: expect.objectContaining({ tenantId, provider: 'MEEST', encryptedCredential: 'ciphertext', accountLabel: 'merchant' }),
      update: expect.objectContaining({ status: 'ACTIVE', encryptedCredential: 'ciphertext', disconnectedAt: null }),
    }));
  });

  it('does not persist credentials when Meest rejects them', async () => {
    const { service, prisma, cipher, validateCredential } = fixture();
    validateCredential.mockRejectedValue(new Error('invalid'));
    await expect(service.connect(tenantId, userId, input)).rejects.toThrow();
    expect(cipher.encrypt).not.toHaveBeenCalled();
    expect(prisma.deliveryConnection.upsert).not.toHaveBeenCalled();
  });

  it('disconnects without deleting delivery history', async () => {
    const { service, prisma } = fixture();
    await expect(service.disconnect(tenantId)).resolves.toMatchObject({ provider: 'MEEST', status: 'DISCONNECTED' });
    expect(prisma.deliveryConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId, provider: 'MEEST' },
      data: expect.objectContaining({ status: 'DISCONNECTED' }),
    }));
  });
});

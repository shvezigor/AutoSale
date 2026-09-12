import { describe, expect, it, vi } from 'vitest';

import { UkrposhtaConnectionService } from './ukrposhta-connection.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-09-12T08:00:00.000Z');
const input = {
  environment: 'SANDBOX' as const,
  ecomBearer: 'ecom-bearer-secret',
  counterpartyToken: 'counterparty-token-secret',
  trackingBearer: 'tracking-bearer-secret',
  counterpartyUuid: '8458f0b0-930f-11e2-a91e-003048d2b473',
};

function fixture() {
  const connection = {
    id: '33333333-3333-4333-8333-333333333333', tenantId, provider: 'UKRPOSHTA', status: 'ACTIVE',
    encryptedCredential: 'ciphertext', credentialGenerationId: '44444444-4444-4444-8444-444444444444',
    accountLabel: 'Counterparty • 8458f0b0', connectedByUserId: userId, lastVerifiedAt: now, lastErrorCode: null,
    disconnectedAt: null, createdAt: now, updatedAt: now,
  };
  const prisma = { deliveryConnection: {
    findUnique: vi.fn().mockResolvedValue(connection),
    upsert: vi.fn().mockResolvedValue(connection),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  } };
  const cipher = { encrypt: vi.fn().mockReturnValue('ciphertext'), decrypt: vi.fn().mockReturnValue(JSON.stringify(input)) };
  const validateCredential = vi.fn().mockResolvedValue({ valid: true, accountLabel: 'Counterparty • 8458f0b0', environment: 'SANDBOX' });
  const factory = vi.fn().mockReturnValue({ validateCredential });
  const service = new UkrposhtaConnectionService(prisma as never, cipher as never, factory, { enabled: true, now: () => now });
  return { service, prisma, cipher, factory, validateCredential };
}

describe('UkrposhtaConnectionService', () => {
  it('returns only a safe tenant-scoped summary with the selected environment', async () => {
    const { service, prisma } = fixture();
    await expect(service.summary(tenantId)).resolves.toEqual({
      enabled: true,
      connection: {
        provider: 'UKRPOSHTA', status: 'ACTIVE', accountLabel: 'Counterparty • 8458f0b0',
        lastVerifiedAt: '2026-09-12T08:00:00.000Z', lastErrorCode: null, environment: 'SANDBOX',
      },
    });
    expect(prisma.deliveryConnection.findUnique).toHaveBeenCalledWith({
      where: { tenantId_provider: { tenantId, provider: 'UKRPOSHTA' } },
    });
    expect(JSON.stringify(await service.summary(tenantId))).not.toMatch(/ecom-bearer|counterparty-token|tracking-bearer|8458f0b0-930f/i);
  });

  it('validates before encrypting and upserts the full credential bundle in the authenticated tenant', async () => {
    const { service, prisma, cipher, factory, validateCredential } = fixture();
    await service.connect(tenantId, userId, input);
    expect(factory).toHaveBeenCalledWith(input);
    expect(validateCredential).toHaveBeenCalledOnce();
    expect(cipher.encrypt).toHaveBeenCalledWith(JSON.stringify(input));
    expect(prisma.deliveryConnection.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_provider: { tenantId, provider: 'UKRPOSHTA' } },
      create: expect.objectContaining({ tenantId, provider: 'UKRPOSHTA', encryptedCredential: 'ciphertext', accountLabel: 'Counterparty • 8458f0b0' }),
      update: expect.objectContaining({ status: 'ACTIVE', encryptedCredential: 'ciphertext', disconnectedAt: null }),
    }));
  });

  it('does not persist credentials when Ukrposhta rejects them', async () => {
    const { service, prisma, cipher, validateCredential } = fixture();
    validateCredential.mockRejectedValue(new Error('invalid'));
    await expect(service.connect(tenantId, userId, input)).rejects.toThrow();
    expect(cipher.encrypt).not.toHaveBeenCalled();
    expect(prisma.deliveryConnection.upsert).not.toHaveBeenCalled();
  });

  it('disconnects by replacing ciphertext without deleting tenant delivery history', async () => {
    const { service, prisma, cipher } = fixture();
    await expect(service.disconnect(tenantId)).resolves.toMatchObject({ provider: 'UKRPOSHTA', status: 'DISCONNECTED', environment: null });
    expect(cipher.encrypt).toHaveBeenCalledOnce();
    expect(prisma.deliveryConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId, provider: 'UKRPOSHTA' },
      data: expect.objectContaining({ status: 'DISCONNECTED', encryptedCredential: 'ciphertext' }),
    }));
  });

  it('builds a tenant-scoped directory client from decrypted active credentials', async () => {
    const { service, prisma, cipher, factory } = fixture();
    const context = await service.clientContextForTenant(tenantId);
    expect(prisma.deliveryConnection.findUnique).toHaveBeenCalledWith({
      where: { tenantId_provider: { tenantId, provider: 'UKRPOSHTA' } },
      select: { status: true, encryptedCredential: true, credentialGenerationId: true },
    });
    expect(cipher.decrypt).toHaveBeenCalledWith('ciphertext');
    expect(factory).toHaveBeenCalledWith(input);
    expect(context.credentialGenerationId).toBe('44444444-4444-4444-8444-444444444444');
  });
});

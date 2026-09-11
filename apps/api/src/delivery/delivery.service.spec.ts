import { describe, expect, it, vi } from 'vitest';

import { DeliveryService, shipmentReadiness } from './delivery.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-09-11T08:00:00.000Z');

const connection = {
  id: '33333333-3333-4333-8333-333333333333',
  tenantId,
  provider: 'NOVA_POSHTA',
  status: 'ACTIVE',
  encryptedCredential: 'ciphertext',
  credentialGenerationId: '44444444-4444-4444-8444-444444444444',
  accountLabel: 'ТОВ Приклад',
  lastVerifiedAt: now,
  lastErrorCode: null,
  senderProfile: null,
};

const profile = {
  senderRef: 'sender-ref',
  contactRef: 'contact-ref',
  contactPhone: '+380501112233',
  origin: { type: 'BRANCH' as const, cityRef: 'city-ref', locationRef: 'branch-ref', label: 'Відділення №1' },
  payer: 'SENDER' as const,
  defaultParcel: { weightKg: 2, lengthCm: 80, widthCm: 20, heightCm: 20 },
  suggestCustomerNotification: true,
  customerNotificationTemplate: '{company}: ТТН {trackingNumber}',
};

function fixture(overrides: Record<string, unknown> = {}) {
  const prisma = {
    deliveryConnection: {
      findUnique: vi.fn().mockResolvedValue(connection),
      upsert: vi.fn().mockResolvedValue(connection),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    deliverySenderProfile: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 'profile-id' }),
    },
    shipment: { count: vi.fn().mockResolvedValue(2) },
  };
  const cipher = {
    encrypt: vi.fn().mockReturnValue('ciphertext'),
    decrypt: vi.fn().mockReturnValue('np-live-key'),
  };
  const validateCredential = vi.fn().mockResolvedValue({ valid: true });
  const listSenderProfiles = vi.fn().mockResolvedValue([{ ref: 'sender-ref', label: 'ТОВ Приклад', edrpou: '12345678' }]);
  const searchCities = vi.fn().mockResolvedValue([]);
  const searchLocations = vi.fn().mockResolvedValue([]);
  const factory = vi.fn().mockReturnValue({ validateCredential, listSenderProfiles, searchCities, searchLocations });
  const service = new DeliveryService(prisma as never, cipher as never, factory, { enabled: true, now: () => now, ...overrides });
  return { service, prisma, cipher, factory, validateCredential, listSenderProfiles };
}

describe('DeliveryService', () => {
  it('allows shipment work only for approved orders whose procurement is complete', () => {
    expect(shipmentReadiness({ status: 'APPROVED', items: [{ procurementStatus: 'IN_STOCK' }, { procurementStatus: 'RECEIVED' }] })).toEqual({ allowed: true });
    expect(shipmentReadiness({ status: 'NEEDS_REVIEW', items: [{ procurementStatus: 'IN_STOCK' }] })).toEqual({ allowed: false, reason: 'ORDER_NOT_APPROVED' });
    expect(shipmentReadiness({ status: 'AUTO_APPROVED', items: [{ procurementStatus: 'TO_ORDER' }] })).toEqual({ allowed: false, reason: 'PROCUREMENT_INCOMPLETE' });
  });

  it('returns only a tenant-scoped safe connection summary', async () => {
    const { service, prisma } = fixture();
    const summary = await service.summary(tenantId);

    expect(prisma.deliveryConnection.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_provider: { tenantId, provider: 'NOVA_POSHTA' } },
    }));
    expect(summary).toMatchObject({
      enabled: true,
      connections: [{ provider: 'NOVA_POSHTA', status: 'ACTIVE', accountLabel: 'ТОВ Приклад' }],
    });
    expect(JSON.stringify(summary)).not.toMatch(/apiKey|encryptedCredential|ciphertext|secret/i);
  });

  it('validates before encrypting and persists a new credential generation', async () => {
    const { service, prisma, cipher, factory, validateCredential } = fixture();
    await service.connect(tenantId, userId, { apiKey: 'np-live-key' });

    expect(factory).toHaveBeenCalledWith('np-live-key');
    expect(validateCredential).toHaveBeenCalledOnce();
    expect(cipher.encrypt).toHaveBeenCalledWith('np-live-key');
    expect(prisma.deliveryConnection.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_provider: { tenantId, provider: 'NOVA_POSHTA' } },
      create: expect.objectContaining({ tenantId, provider: 'NOVA_POSHTA', encryptedCredential: 'ciphertext', connectedByUserId: userId }),
      update: expect.objectContaining({ encryptedCredential: 'ciphertext', status: 'ACTIVE', disconnectedAt: null }),
    }));
    const call = prisma.deliveryConnection.upsert.mock.calls[0]?.[0];
    expect(call.create.credentialGenerationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(call.update.credentialGenerationId).toBe(call.create.credentialGenerationId);
  });

  it('does not persist or encrypt an invalid provider key', async () => {
    const { service, prisma, cipher, validateCredential } = fixture();
    validateCredential.mockRejectedValue(new Error('invalid'));

    await expect(service.connect(tenantId, userId, { apiKey: 'np-live-key' })).rejects.toThrow();
    expect(cipher.encrypt).not.toHaveBeenCalled();
    expect(prisma.deliveryConnection.upsert).not.toHaveBeenCalled();
  });

  it('stores sender defaults only against the active connection in the tenant', async () => {
    const { service, prisma } = fixture();
    await expect(service.saveSenderProfile(tenantId, profile)).resolves.toEqual(profile);
    expect(prisma.deliverySenderProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_connectionId: { tenantId, connectionId: connection.id } },
      create: expect.objectContaining({ tenantId, connectionId: connection.id, senderRef: 'sender-ref', originType: 'BRANCH' }),
    }));
  });

  it('decrypts the tenant credential only server-side to load sender choices', async () => {
    const { service, prisma, cipher, factory, listSenderProfiles } = fixture();
    const options = await service.senderOptions(tenantId);
    expect(prisma.deliveryConnection.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_provider: { tenantId, provider: 'NOVA_POSHTA' } },
      select: { status: true, encryptedCredential: true, credentialGenerationId: true },
    }));
    expect(cipher.decrypt).toHaveBeenCalledWith('ciphertext');
    expect(factory).toHaveBeenCalledWith('np-live-key');
    expect(listSenderProfiles).toHaveBeenCalledOnce();
    expect(JSON.stringify(options)).not.toMatch(/np-live-key|ciphertext|encryptedCredential|apiKey/i);
  });

  it('disconnects without deleting the connection, sender defaults or shipment history', async () => {
    const { service, prisma } = fixture();
    await service.disconnect(tenantId);

    expect(prisma.deliveryConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId, provider: 'NOVA_POSHTA' },
      data: expect.objectContaining({ status: 'DISCONNECTED', disconnectedAt: now }),
    }));
    expect(prisma.shipment.count).not.toHaveBeenCalled();
    expect(prisma.deliverySenderProfile.upsert).not.toHaveBeenCalled();
  });

  it('does not expose or mutate connections when the feature is disabled', async () => {
    const { service, prisma } = fixture({ enabled: false });
    await expect(service.summary(tenantId)).resolves.toEqual({ enabled: false, connections: [] });
    await expect(service.connect(tenantId, userId, { apiKey: 'np-live-key' })).rejects.toThrow('disabled');
    expect(prisma.deliveryConnection.findUnique).not.toHaveBeenCalled();
  });
});

describe('DeliveryService shipment review', () => {
  const approvedOrder = {
    id: '55555555-5555-4555-8555-555555555555', tenantId, status: 'APPROVED',
    extraction: {
      customer: { name: 'Олена', phone: '+380671234567' },
      delivery: { city: 'Київ', novaPoshtaBranch: '24', address: null },
    },
    items: [{ catalogId: 'SKU-1', quantity: 2, procurementStatus: 'IN_STOCK', originalText: 'Двері Авангард' }],
  };
  const senderProfile = {
    senderRef: 'sender-ref', contactRef: 'contact-ref', contactPhone: '+380501112233',
    originType: 'BRANCH', originCityRef: 'sender-city', originLocationRef: 'sender-branch', originAddressRef: null,
    originBuilding: null, originFlat: null, originLabel: 'Відділення №1', payer: 'SENDER',
    defaultWeightKg: 2, defaultLengthCm: 80, defaultWidthCm: 20, defaultHeightCm: 205,
    suggestCustomerNotification: true, customerNotificationTemplate: '{company}: {trackingNumber}',
  };

  function shipmentFixture() {
    const calculateShipment = vi.fn().mockResolvedValue({ currency: 'UAH', cost: 120, estimatedDeliveryDate: '2026-09-13' });
    const prisma = {
      order: { findFirst: vi.fn().mockResolvedValue(approvedOrder) },
      product: { findMany: vi.fn().mockResolvedValue([{ sku: 'SKU-1', name: 'Двері Авангард', price: 2500 }]) },
      deliveryConnection: { findUnique: vi.fn().mockResolvedValue({ ...connection, senderProfile }) },
      shipment: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(({ data }) => Promise.resolve({
        id: '66666666-6666-4666-8666-666666666666', ...data, trackingNumber: null, cost: null, currency: 'UAH',
        createdAt: new Date('2026-09-11T08:00:00.000Z'), providerCreatedAt: null, acceptedAt: null, deliveredAt: null,
        cancelledAt: null, lastStatusCheckedAt: null, lastErrorCode: null, statusEvents: [],
      })), update: vi.fn() },
    };
    const cipher = { encrypt: vi.fn(), decrypt: vi.fn().mockReturnValue('np-live-key') };
    const factory = vi.fn().mockReturnValue({
      validateCredential: vi.fn(), listSenderProfiles: vi.fn(), searchCities: vi.fn(), searchLocations: vi.fn(), calculateShipment,
    });
    return { service: new DeliveryService(prisma as never, cipher as never, factory, { enabled: true }), prisma, calculateShipment };
  }

  it('prefills customer hints and tenant defaults without treating AI text as exact refs', async () => {
    const { service } = shipmentFixture();
    await expect(service.shipmentOverview(tenantId, approvedOrder.id)).resolves.toMatchObject({
      canCreateShipment: true,
      blockedReason: null,
      shipment: null,
      draft: {
        recipient: { name: 'Олена', phone: '+380671234567' },
        cityHint: 'Київ', locationHint: '24', payer: 'SENDER', declaredValue: 5000,
        parcels: [{ weightKg: 2, lengthCm: 80, widthCm: 20, heightCm: 205 }],
      },
    });
  });

  it('quotes a complete exact draft without creating or advancing a shipment', async () => {
    const { service, prisma, calculateShipment } = shipmentFixture();
    const draft = {
      provider: 'NOVA_POSHTA' as const,
      recipient: { name: 'Олена', phone: '+380671234567' },
      destination: { type: 'BRANCH' as const, cityRef: 'recipient-city', locationRef: 'recipient-branch', label: 'Відділення №24' },
      parcels: [{ weightKg: 2, lengthCm: 80, widthCm: 20, heightCm: 205 }],
      payer: 'RECIPIENT' as const, declaredValue: 5000, codAmount: 5000, description: 'Двері Авангард',
    };
    await expect(service.quoteShipment(tenantId, approvedOrder.id, draft)).resolves.toEqual({ currency: 'UAH', cost: 120, estimatedDeliveryDate: '2026-09-13' });
    expect(calculateShipment).toHaveBeenCalledWith(expect.objectContaining({
      sender: expect.objectContaining({ counterpartyRef: 'sender-ref', locationRef: 'sender-branch' }),
      recipient: expect.objectContaining({ cityRef: 'recipient-city', locationRef: 'recipient-branch' }),
    }));
    expect(prisma.shipment.create).not.toHaveBeenCalled();
    expect(prisma.shipment.update).not.toHaveBeenCalled();
  });

  it('persists an exact draft snapshot without contacting Nova Poshta', async () => {
    const { service, prisma, calculateShipment } = shipmentFixture();
    const draft = {
      provider: 'NOVA_POSHTA' as const,
      recipient: { name: 'Олена', phone: '+380671234567' },
      destination: { type: 'BRANCH' as const, cityRef: 'recipient-city', locationRef: 'recipient-branch', label: 'Відділення №24' },
      parcels: [{ weightKg: 2, lengthCm: 80, widthCm: 20, heightCm: 205 }], payer: 'RECIPIENT' as const,
      declaredValue: 5000, codAmount: null, description: 'Двері Авангард',
    };
    await expect(service.saveShipmentDraft(tenantId, approvedOrder.id, userId, draft)).resolves.toMatchObject({ status: 'DRAFT', orderId: approvedOrder.id });
    expect(prisma.shipment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      tenantId, orderId: approvedOrder.id, createdByUserId: userId, recipientSnapshot: draft.recipient,
      destinationSnapshot: draft.destination, status: 'DRAFT', requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }) }));
    expect(calculateShipment).not.toHaveBeenCalled();
  });

  it('rejects incomplete procurement before quoting', async () => {
    const { service, prisma, calculateShipment } = shipmentFixture();
    prisma.order.findFirst.mockResolvedValue({ ...approvedOrder, items: [{ ...approvedOrder.items[0], procurementStatus: 'TO_ORDER' }] });
    await expect(service.quoteShipment(tenantId, approvedOrder.id, {})).rejects.toThrow('PROCUREMENT_INCOMPLETE');
    expect(calculateShipment).not.toHaveBeenCalled();
  });
});

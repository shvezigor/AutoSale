import { describe, expect, it, vi } from 'vitest';
import { NovaPoshtaError } from '@autosale/integrations';

import { ShipmentCreateService } from './shipment-create.service.js';

const now = new Date('2026-09-11T10:00:00.000Z');
const shipmentId = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';

function candidate(status: 'PENDING' | 'UNKNOWN' = 'PENDING') {
  return {
    id: '33333333-3333-4333-8333-333333333333', tenantId, shipmentId, version: 1, operation: 'CREATE', status,
    attempts: status === 'UNKNOWN' ? 1 : 0, leaseId: null,
    shipment: {
      id: shipmentId, tenantId, status: 'CREATING', senderSnapshot: {
        senderRef: 'sender', contactRef: 'contact', contactPhone: '+380501112233',
        origin: { type: 'BRANCH', cityRef: 'sender-city', locationRef: 'sender-branch', label: 'Відділення №1' },
        payer: 'SENDER', defaultParcel: { weightKg: 2, lengthCm: 80, widthCm: 20, heightCm: 205 },
        suggestCustomerNotification: true, customerNotificationTemplate: '{trackingNumber}',
      },
      recipientSnapshot: { name: 'Олена', phone: '+380671234567' },
      destinationSnapshot: { type: 'BRANCH', cityRef: 'city', locationRef: 'branch', label: 'Відділення №24' },
      parcels: [{ weightKg: 2, lengthCm: 80, widthCm: 20, heightCm: 205 }], payer: 'SENDER',
      declaredValue: 5000, codAmount: null, description: 'Двері', connection: { encryptedCredential: 'ciphertext' },
    },
  };
}

function fixture(attempt = candidate()) {
  const prisma = {
    shipmentAttempt: { findFirst: vi.fn().mockResolvedValue(attempt), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    shipment: { update: vi.fn().mockResolvedValue({}), findUniqueOrThrow: vi.fn().mockResolvedValue({ tenantId }) },
    shipmentStatusEvent: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn().mockImplementation(async (run) => run(prisma)),
  };
  const client = {
    createShipment: vi.fn().mockResolvedValue({ documentRef: 'document-ref', trackingNumber: '20450000000000', cost: 120 }),
    findShipmentByClientRef: vi.fn().mockResolvedValue(null),
  };
  return { prisma, client, service: new ShipmentCreateService(prisma as never, () => client, vi.fn().mockReturnValue('api-key'), () => now) };
}

describe('ShipmentCreateService', () => {
  it('claims one lease and stores the created TTN only while that lease is current', async () => {
    const { service, prisma, client } = fixture();
    await expect(service.process({ shipmentId })).resolves.toBe('CREATED');
    expect(client.createShipment).toHaveBeenCalledWith(expect.objectContaining({ clientRef: `shipment:${shipmentId}:1` }));
    expect(prisma.shipment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CREATED', trackingNumber: '20450000000000' }) }));
    expect(prisma.shipmentAttempt.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'PROCESSING', leaseId: expect.any(String) }) }));
  });

  it('reconciles an unknown provider outcome before attempting another create', async () => {
    const { service, client } = fixture(candidate('UNKNOWN'));
    client.findShipmentByClientRef.mockResolvedValue({ documentRef: 'found-ref', trackingNumber: '20450000000001', clientRef: `shipment:${shipmentId}:1` });
    await expect(service.process({ shipmentId })).resolves.toBe('CREATED');
    expect(client.findShipmentByClientRef).toHaveBeenCalledWith(`shipment:${shipmentId}:1`);
    expect(client.createShipment).not.toHaveBeenCalled();
  });

  it('keeps network timeouts in UNKNOWN instead of issuing an immediate fresh create', async () => {
    const { service, prisma, client } = fixture();
    client.createShipment.mockRejectedValue(new NovaPoshtaError('TIMEOUT', null));
    await expect(service.process({ shipmentId })).resolves.toBe('UNKNOWN');
    expect(prisma.shipmentAttempt.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'UNKNOWN', lastErrorCode: 'NOVA_POSHTA_OUTCOME_UNKNOWN' }) }));
  });
});

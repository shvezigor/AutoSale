import { describe, expect, it, vi } from 'vitest';

vi.mock('@autosale/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@autosale/database')>()),
  withTenantTransaction: async <T>(prisma: { $transaction?: (operation: (transaction: unknown) => Promise<T>) => Promise<T> }, _tenantId: string, operation: (transaction: unknown) => Promise<T>) => prisma.$transaction ? prisma.$transaction(operation) : operation(prisma),
}));
vi.mock('./delivery-authority.js', () => ({ resolveShipmentTenant: vi.fn().mockResolvedValue('11111111-1111-4111-8111-111111111111') }));

import { mapNovaPoshtaStatus, ShipmentStatusService } from './shipment-status.service.js';

describe('mapNovaPoshtaStatus', () => {
  it('routes Ukrposhta cancellation and declines status polling without calling Nova Poshta', async () => {
    const prisma = { shipmentAttempt: { findFirst: vi.fn().mockResolvedValue({ shipment: { provider: 'UKRPOSHTA', status: 'CREATED', providerDocumentId: 'uuid', trackingNumber: 'barcode' } }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
    const np = vi.fn(); const up = { cancel: vi.fn().mockResolvedValue('CANCELLED') };
    const service = new ShipmentStatusService(prisma as never, np, () => 'secret', () => new Date(), up);
    await expect(service.cancel({ shipmentId: 'uuid' })).resolves.toBe('CANCELLED');
    await expect(service.process({ shipmentId: 'uuid' })).resolves.toBe('IGNORED');
    expect(np).not.toHaveBeenCalled(); expect(prisma.shipmentAttempt.updateMany).not.toHaveBeenCalled();
  });
  it('maps known lifecycle codes and preserves unknown provider codes', () => {
    expect(mapNovaPoshtaStatus('1')).toBe('CREATED');
    expect(mapNovaPoshtaStatus('5')).toBe('IN_TRANSIT');
    expect(mapNovaPoshtaStatus('9')).toBe('DELIVERED');
    expect(mapNovaPoshtaStatus('106')).toBe('RETURNING');
    expect(mapNovaPoshtaStatus('108')).toBe('RETURNED');
    expect(mapNovaPoshtaStatus('new-code')).toBeNull();
  });

  it('does not cancel a Nova Poshta shipment when tenant ingestion is frozen', async () => {
    const attempt = {
      id: 'attempt', tenantId: '11111111-1111-4111-8111-111111111111', shipmentId: 'shipment', status: 'PENDING',
      shipment: { provider: 'NOVA_POSHTA', status: 'CREATED', providerDocumentId: 'document', trackingNumber: 'tracking', connection: { encryptedCredential: 'ciphertext' } },
    };
    const prisma = {
      shipmentAttempt: { findFirst: vi.fn().mockResolvedValue(attempt), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      shipment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      tenantLifecycleRequest: { findFirst: vi.fn().mockResolvedValue({ id: 'delete-request' }) },
    };
    const cancelShipment = vi.fn();
    const service = new ShipmentStatusService(prisma as never, () => ({ getShipmentStatus: vi.fn(), cancelShipment }), () => 'secret');

    await expect(service.cancel({ shipmentId: 'shipment' })).resolves.toBe('IGNORED_FROZEN');
    expect(cancelShipment).not.toHaveBeenCalled();
  });
});

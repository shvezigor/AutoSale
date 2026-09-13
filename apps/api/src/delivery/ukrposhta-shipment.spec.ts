import { describe, expect, it, vi } from 'vitest';
import { DeliveryService } from './delivery.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-09-13T09:00:00Z');
const credentials = { environment: 'SANDBOX', ecomBearer: 'bearer-secret', counterpartyToken: 'token-secret', trackingBearer: 'tracking-secret', counterpartyUuid: id };
const profile = { senderRef: 'Петренко Іван Іванович', contactRef: 'UKRPOSHTA_SENDER', contactPhone: '+380501112233', originType: 'BRANCH', originCityRef: '1:2', originLocationRef: 'up:12:01001', originLabel: 'Назва без індексу', originAddressRef: null, originBuilding: null, originFlat: null, payer: 'SENDER', defaultWeightKg: 1, defaultLengthCm: 30, defaultWidthCm: 20, defaultHeightCm: 10, suggestCustomerNotification: false, customerNotificationTemplate: '{company}: {trackingNumber} {trackingUrl}' };
const connection = { id, tenantId, provider: 'UKRPOSHTA', status: 'ACTIVE', encryptedCredential: 'cipher', credentialGenerationId: id, senderProfile: profile };
const draft = { provider: 'UKRPOSHTA' as const, recipient: { name: 'Шевченко Олена', phone: '+380671234567' }, destination: { type: 'BRANCH' as const, cityRef: '263:297', locationRef: 'up:1:43000', label: 'Довільна назва' }, parcels: [{ weightKg: 1, lengthCm: 30, widthCm: 20, heightCm: 10 }], payer: 'RECIPIENT' as const, declaredValue: 500, codAmount: null, description: 'Запчастини' };
const stored = { id, tenantId, orderId, provider: 'UKRPOSHTA', status: 'DRAFT', connectionId: id, version: 1, requestHash: 'hash', trackingNumber: null, cost: null, createdAt: now, providerCreatedAt: null, acceptedAt: null, deliveredAt: null, cancelledAt: null, lastStatusCheckedAt: null, lastErrorCode: null, statusEvents: [], providerMetadata: { environment: 'SANDBOX', credentialGenerationId: id }, connection };

function fixture(enabled = false) {
  const prisma = {
    order: { findFirst: vi.fn().mockResolvedValue({ id: orderId, tenantId, status: 'APPROVED', items: [], extraction: {} }) },
    product: { findMany: vi.fn().mockResolvedValue([]) },
    deliveryConnection: { findUnique: vi.fn().mockResolvedValue(connection), findMany: vi.fn().mockResolvedValue([connection]) },
    shipment: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(async ({ data }) => ({ ...stored, ...data })), update: vi.fn().mockImplementation(async ({ data }) => ({ ...stored, ...data })), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    shipmentAttempt: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    tenant: { findUnique: vi.fn().mockResolvedValue({ name: 'Магазин' }) }, message: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (run) => run(prisma));
  const client = { calculateShipment: vi.fn().mockResolvedValue({ cost: 90, currency: 'UAH', estimatedDeliveryDate: null }), getLabel: vi.fn().mockResolvedValue(new TextEncoder().encode('%PDF-1.4')), getLifecycle: vi.fn().mockResolvedValue({ status: 'CREATED', statusDate: '2026-09-13T09:00:00' }) };
  const np = vi.fn(); const queue = { add: vi.fn() }; const send = vi.fn();
  const cipher = { decrypt: vi.fn().mockReturnValue(JSON.stringify(credentials)) };
  const service = new DeliveryService(prisma as never, cipher as never, np, { enabled: true, ukrposhtaSandboxShipmentsEnabled: enabled }, queue, { send }, () => client);
  return { service, prisma, client, np, queue, send, cipher };
}

describe('Ukrposhta shipment API service', () => {
  it('refuses label downloads under a replaced provider environment', async () => {
    const { service, prisma, client, cipher } = fixture();
    prisma.shipment.findFirst.mockResolvedValue({ ...stored, status: 'CREATED', providerDocumentId: id, trackingNumber: '0500113014256' });
    cipher.decrypt.mockReturnValue(JSON.stringify({ ...credentials, environment: 'PRODUCTION' }));
    await expect(service.shipmentLabel(tenantId, id)).rejects.toThrow('SHIPMENT_CONNECTION_CHANGED');
    expect(client.getLabel).not.toHaveBeenCalled();
  });

  it('rejects a stale sender branch reference during review with a safe settings requirement', async () => {
    const { service, prisma } = fixture();
    prisma.deliveryConnection.findUnique.mockResolvedValue({ ...connection, senderProfile: { ...profile, originLocationRef: '12' } });
    await expect(service.shipmentOverview(tenantId, orderId, 'UKRPOSHTA')).resolves.toMatchObject({ canCreateShipment: false, blockedReason: 'SENDER_PROFILE_REQUIRED' });
  });

  it('rejects production creates even if sandbox enablement is true', async () => {
    const { service, prisma, queue, cipher } = fixture(true);
    prisma.shipment.findFirst.mockResolvedValue(stored);
    cipher.decrypt.mockReturnValue(JSON.stringify({ ...credentials, environment: 'PRODUCTION' }));
    await expect(service.createShipment(tenantId, orderId, id)).rejects.toThrow('UKRPOSHTA_CREATION_DISABLED');
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('prefills an active Ukrposhta connection and exposes the disabled create gate while allowing draft review', async () => {
    const { service, np } = fixture();
    await expect(service.shipmentOverview(tenantId, orderId, 'UKRPOSHTA')).resolves.toMatchObject({ canCreateShipment: true, creationEnabled: false, draft: { provider: 'UKRPOSHTA' }, availableProviders: ['UKRPOSHTA'] });
    expect(np).not.toHaveBeenCalled();
  });
  it('persists carrier, exact branch and connection generation on the existing intent', async () => {
    const { service, prisma, np } = fixture();
    await expect(service.saveShipmentDraft(tenantId, orderId, id, draft)).resolves.toMatchObject({ provider: 'UKRPOSHTA' });
    expect(prisma.shipment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ provider: 'UKRPOSHTA', connectionId: id, destinationSnapshot: draft.destination, providerMetadata: { environment: 'SANDBOX', credentialGenerationId: id } }) }));
    expect(np).not.toHaveBeenCalled();
  });
  it('calculates quote using opaque postcode fields and keeps provider calls out of draft save', async () => {
    const { service, client } = fixture();
    await expect(service.quoteShipment(tenantId, orderId, draft)).resolves.toMatchObject({ cost: 90 });
    expect(client.calculateShipment).toHaveBeenCalledWith(expect.objectContaining({ senderPostcode: '01001', recipientPostcode: '43000' }));
  });
  it('rejects a disabled create before persisting or enqueueing provider work', async () => {
    const { service, prisma, queue } = fixture();
    prisma.shipment.findFirst.mockResolvedValue(stored);
    await expect(service.createShipment(tenantId, orderId, id)).rejects.toThrow('UKRPOSHTA_CREATION_DISABLED');
    expect(prisma.shipmentAttempt.upsert).not.toHaveBeenCalled(); expect(queue.add).not.toHaveBeenCalled();
  });
  it('queues enabled sandbox create through the durable attempt', async () => {
    const { service, prisma, queue } = fixture(true);
    prisma.shipment.findFirst.mockResolvedValueOnce(stored).mockResolvedValueOnce({ ...stored, status: 'CREATING' });
    await expect(service.createShipment(tenantId, orderId, id)).resolves.toMatchObject({ status: 'CREATING' });
    expect(prisma.shipmentAttempt.upsert).toHaveBeenCalled(); expect(queue.add).toHaveBeenCalledOnce();
  });
  it('downloads an authorized provider-aware PDF filename with no tokenized URL', async () => {
    const { service, prisma, np } = fixture();
    prisma.shipment.findFirst.mockResolvedValue({ ...stored, status: 'CREATED', providerDocumentId: id, trackingNumber: '0500113014256' });
    await expect(service.shipmentLabel(tenantId, id)).resolves.toMatchObject({ filename: 'ukrposhta-0500113014256.pdf' });
    expect(np).not.toHaveBeenCalled();
  });
  it('rechecks lifecycle and rejects cancellation after registration without enqueueing', async () => {
    const { service, prisma, client, queue } = fixture();
    prisma.shipment.findFirst.mockResolvedValue({ ...stored, status: 'CREATED', providerDocumentId: id });
    client.getLifecycle.mockResolvedValue({ status: 'REGISTERED', statusDate: '2026-09-13T09:00:00' });
    await expect(service.cancelShipment(tenantId, id)).rejects.toThrow('SHIPMENT_CANNOT_BE_CANCELLED');
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('builds a manual tenant-branded Ukrposhta tracking preview without sending it', async () => {
    const { service, prisma, send } = fixture();
    prisma.shipment.findFirst.mockResolvedValue({ ...stored, status: 'CREATED', trackingNumber: '0500113014256', order: { conversationId: id } });
    const result = await service.customerMessagePreview(tenantId, id);
    expect(result.text).toBe('Магазин: 0500113014256 https://track.ukrposhta.ua/tracking_UA.html?barcode=0500113014256');
    expect(send).not.toHaveBeenCalled();
  });
});

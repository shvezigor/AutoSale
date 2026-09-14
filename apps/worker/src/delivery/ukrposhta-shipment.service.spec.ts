import { describe, expect, it, vi } from 'vitest';
import { UkrposhtaError } from '@autosale/integrations';
import { UkrposhtaShipmentService } from './ukrposhta-shipment.service.js';

const id = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';
const remoteId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-09-13T09:00:00Z');
const credentials = { environment: 'SANDBOX', ecomBearer: 'bearer-secret', counterpartyToken: 'token-secret', trackingBearer: 'tracking-secret', counterpartyUuid: id };
const remote = { uuid: remoteId, barcode: '0500113014256', deliveryPrice: 80, parcels: [{ uuid: remoteId, barcode: '0500113014256' }], lifecycle: { status: 'CREATED', statusDate: '2026-09-13T09:00:00' } };

function fixture(options: { enabled?: boolean; metadata?: object; status?: string; environment?: string } = {}) {
  const shipment: Record<string, any> = { id, tenantId, provider: 'UKRPOSHTA', status: 'CREATING', version: 1,
    providerMetadata: { environment: options.environment ?? 'SANDBOX', credentialGenerationId: id, ...options.metadata },
    connection: { status: 'ACTIVE', encryptedCredential: 'cipher', credentialGenerationId: id },
    senderSnapshot: { senderRef: 'Петренко Іван Іванович', contactRef: 'UKRPOSHTA_SENDER', contactPhone: '+380501112233', origin: { type: 'BRANCH', cityRef: '1:2', locationRef: 'up:12:01001', label: 'Назва' }, payer: 'SENDER', defaultParcel: { weightKg: 1, lengthCm: 30, widthCm: 20, heightCm: 10 }, suggestCustomerNotification: false, customerNotificationTemplate: '{company}' },
    recipientSnapshot: { name: 'Шевченко Олена', phone: '+380671234567' }, destinationSnapshot: { type: 'BRANCH', cityRef: '3:4', locationRef: 'up:1:43000', label: 'Не індекс' },
    parcels: [{ weightKg: 1, lengthCm: 30, widthCm: 20, heightCm: 10 }], payer: 'RECIPIENT', declaredValue: 500, codAmount: null, description: 'Запчастини',
  };
  const attempt: Record<string, any> = { id: remoteId, tenantId, shipmentId: id, version: 1, operation: 'CREATE', status: options.status ?? 'PENDING', attempts: 0, leaseId: null, leaseExpiresAt: new Date(now.getTime() - 1), shipment };
  const checkpoints: any[] = [];
  const prisma = {
    shipmentAttempt: { findFirst: vi.fn().mockImplementation(async () => ['SUCCEEDED', 'FAILED'].includes(attempt.status) ? null : structuredClone(attempt)), updateMany: vi.fn().mockImplementation(async ({ where, data }) => { if (where.status !== attempt.status || where.leaseId !== undefined && where.leaseId !== attempt.leaseId || where.leaseExpiresAt?.lte && attempt.leaseExpiresAt > where.leaseExpiresAt.lte || where.leaseExpiresAt?.gt && attempt.leaseExpiresAt <= where.leaseExpiresAt.gt) return { count: 0 }; Object.assign(attempt, data); return { count: 1 }; }) },
    shipment: { update: vi.fn().mockImplementation(async ({ data }) => { Object.assign(shipment, data); checkpoints.push(structuredClone(data)); return shipment; }) },
    shipmentStatusEvent: { create: vi.fn() }, $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (run) => run(prisma));
  const clients = new Map<string, { uuid: string; addressId: number; externalId: string }>();
  let addressId = 10;
  const client = { createAddress: vi.fn().mockImplementation(async (postcode) => ({ id: addressId++, postcode })), getAddress: vi.fn(),
    findClientByExternalId: vi.fn().mockImplementation(async (key) => clients.get(key) ?? null),
    createClient: vi.fn().mockImplementation(async (data) => { const result = { uuid: remoteId, addressId: data.addressId, externalId: data.externalId }; clients.set(data.externalId, result); return result; }),
    createShipment: vi.fn().mockImplementation(async () => { expect(shipment.providerMetadata.createDispatched).toBe(true); return remote; }),
    getShipment: vi.fn().mockResolvedValue(remote), getShipmentByBarcode: vi.fn().mockResolvedValue(remote),
    getLifecycle: vi.fn().mockResolvedValue(remote.lifecycle), cancelShipment: vi.fn().mockResolvedValue({ cancelled: true }),
  };
  const factory = vi.fn().mockReturnValue(client);
  const service = new UkrposhtaShipmentService(prisma as never, factory, () => JSON.stringify({ ...credentials, environment: options.environment ?? 'SANDBOX' }), { enabled: options.enabled ?? true, now: () => now });
  return { service, prisma, shipment, attempt, client, factory, checkpoints };
}

describe('durable Ukrposhta shipment jobs', () => {
  it.each([[400, 'VALIDATION'], [401, 'UNAUTHORIZED'], [404, 'NOT_FOUND'], [429, 'RATE_LIMITED']] as const)('records definitive create HTTP %s as failed without retrying POST', async (status, code) => {
    const { service, shipment, attempt, client } = fixture();
    client.createShipment.mockRejectedValue(new UkrposhtaError(code, status));
    await expect(service.process({ shipmentId: id })).resolves.toBe('FAILED');
    expect(shipment).toMatchObject({ status: 'FAILED', lastErrorCode: `UKRPOSHTA_${code}` });
    expect(attempt.status).toBe('FAILED');
    await expect(service.process({ shipmentId: id })).resolves.toBe('IGNORED');
    expect(client.createShipment).toHaveBeenCalledOnce();
  });
  it('does not steal an expired candidate whose owner has renewed its lease', async () => {
    const { service, prisma, client, attempt } = fixture({ status: 'PROCESSING' });
    prisma.shipmentAttempt.findFirst.mockImplementationOnce(async () => {
      const stale = structuredClone(attempt);
      attempt.leaseExpiresAt = new Date(now.getTime() + 60_000);
      return stale;
    });
    await expect(service.process({ shipmentId: id })).resolves.toBe('IGNORED');
    expect(client.createShipment).not.toHaveBeenCalled();
    expect(client.createAddress).not.toHaveBeenCalled();
  });

  it('exposes terminal cancellation failure safely without changing the shipment lifecycle', async () => {
    const { service, shipment, attempt, client } = fixture();
    shipment.status = 'CREATED'; shipment.providerDocumentId = remoteId; attempt.operation = 'CANCEL';
    client.getLifecycle.mockRejectedValue(new UkrposhtaError('UNAUTHORIZED', 401));
    await expect(service.cancel({ shipmentId: id })).resolves.toBe('IGNORED');
    expect(shipment).toMatchObject({ status: 'CREATED', lastErrorCode: 'UKRPOSHTA_UNAUTHORIZED' });
    expect(attempt).toMatchObject({ status: 'FAILED', completedAt: now });
  });
  it('treats UNKNOWN as ambiguous even when dispatch metadata is absent', async () => {
    const { service, client } = fixture({ status: 'UNKNOWN' });
    await expect(service.process({ shipmentId: id })).resolves.toBe('UNKNOWN');
    expect(client.createShipment).not.toHaveBeenCalled();
  });

  it('records successful deletion and lets repeated cancellation jobs converge', async () => {
    const { service, shipment, attempt, client } = fixture();
    shipment.status = 'CREATED'; shipment.providerDocumentId = remoteId; attempt.operation = 'CANCEL';
    await expect(service.cancel({ shipmentId: id })).resolves.toBe('CANCELLED');
    expect(shipment).toMatchObject({ status: 'CANCELLED', lastProviderCode: 'DELETED', providerMetadata: { lifecycle: { status: 'DELETED' } } });
    await expect(service.cancel({ shipmentId: id })).resolves.toBe('IGNORED');
    expect(client.cancelShipment).toHaveBeenCalledOnce();
  });

  it('recovers an ambiguous deletion when the provider confirms the shipment is gone', async () => {
    const { service, shipment, attempt, client } = fixture({ status: 'RETRYABLE' });
    shipment.status = 'CREATED'; shipment.providerDocumentId = remoteId; attempt.operation = 'CANCEL';
    shipment.providerMetadata.deleteDispatched = true;
    client.getLifecycle.mockRejectedValue(new UkrposhtaError('NOT_FOUND', 404));
    await expect(service.cancel({ shipmentId: id })).resolves.toBe('CANCELLED');
    expect(shipment.status).toBe('CANCELLED'); expect(client.cancelShipment).not.toHaveBeenCalled();
  });
  it('checkpoints provisioning and dispatch before create, stores metadata and never repeats a successful job', async () => {
    const { service, shipment, client } = fixture();
    await expect(service.process({ shipmentId: id })).resolves.toBe('CREATED');
    expect(shipment).toMatchObject({ status: 'CREATED', providerDocumentId: remoteId, trackingNumber: '0500113014256', cost: 80, nextStatusCheckAt: new Date('2026-09-13T09:15:00.000Z'), providerMetadata: { senderAddressId: 10, recipientAddressId: 11, senderUuid: remoteId, recipientUuid: remoteId, createDispatched: true, parcels: remote.parcels, lifecycle: remote.lifecycle } });
    await expect(service.process({ shipmentId: id })).resolves.toBe('IGNORED');
    expect(client.createShipment).toHaveBeenCalledOnce();
  });

  it('schedules tracking when create already reports physical registration', async () => {
    const { service, shipment, client } = fixture();
    client.createShipment.mockResolvedValueOnce({ ...remote, lifecycle: { status: 'REGISTERED', statusDate: '2026-09-13T12:00:00' } });

    await expect(service.process({ shipmentId: id })).resolves.toBe('CREATED');
    expect(shipment).toMatchObject({ status: 'ACCEPTED', nextStatusCheckAt: new Date('2026-09-13T09:15:00.000Z') });
  });
  it.each(['UNKNOWN', 'PROCESSING'])('never resends a dispatched shipment after %s without remote identity', async (status) => {
    const { service, shipment, client } = fixture({ status, metadata: { createDispatched: true } });
    await expect(service.process({ shipmentId: id })).resolves.toBe('UNKNOWN');
    expect(shipment.status).toBe('CREATING'); expect(shipment.lastErrorCode).toBe('UKRPOSHTA_OUTCOME_UNKNOWN');
    expect(client.createShipment).not.toHaveBeenCalled(); expect(client.createAddress).not.toHaveBeenCalled();
  });
  it('reconciles persisted remote identity without a second POST after interruption', async () => {
    const { service, shipment, client } = fixture({ status: 'PROCESSING', metadata: { createDispatched: true, shipmentUuid: remoteId } });
    await expect(service.process({ shipmentId: id })).resolves.toBe('CREATED');
    expect(client.getShipment).toHaveBeenCalledWith(remoteId); expect(client.createShipment).not.toHaveBeenCalled(); expect(shipment.trackingNumber).toBe('0500113014256');
  });
  it('retains unknown outcome through repeated jobs after an ambiguous create', async () => {
    const { service, client, shipment } = fixture();
    client.createShipment.mockRejectedValue(new UkrposhtaError('UNKNOWN_CREATE', null));
    await expect(service.process({ shipmentId: id })).resolves.toBe('UNKNOWN');
    await expect(service.process({ shipmentId: id })).resolves.toBe('UNKNOWN');
    expect(client.createShipment).toHaveBeenCalledOnce(); expect(shipment.status).toBe('CREATING');
  });
  it.each([{ enabled: false }, { environment: 'PRODUCTION' }])('blocks provider provisioning when creation is gated %j', async (options) => {
    const { service, factory, shipment } = fixture(options);
    await expect(service.process({ shipmentId: id })).resolves.toBe('FAILED');
    expect(factory).not.toHaveBeenCalled(); expect(shipment.lastErrorCode).toBe('UKRPOSHTA_CREATION_DISABLED');
  });
  it('refuses to reuse checkpoints after connection credentials change', async () => {
    const { service, shipment, factory } = fixture();
    shipment.connection.credentialGenerationId = tenantId;
    await expect(service.process({ shipmentId: id })).resolves.toBe('FAILED');
    expect(factory).not.toHaveBeenCalled(); expect(shipment.lastErrorCode).toBe('UKRPOSHTA_CONNECTION_CHANGED');
  });
  it('reuses provisioned IDs on restart instead of creating new clients', async () => {
    const { service, client } = fixture({ status: 'PROCESSING', metadata: { senderUuid: remoteId, recipientUuid: remoteId, senderAddressId: 10, recipientAddressId: 11 } });
    await expect(service.process({ shipmentId: id })).resolves.toBe('CREATED');
    expect(client.createClient).not.toHaveBeenCalled(); expect(client.createAddress).not.toHaveBeenCalled();
  });
  it('honors a lost lease before any remote create', async () => {
    const { service, prisma, client } = fixture();
    prisma.shipmentAttempt.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.process({ shipmentId: id })).resolves.toBe('IGNORED');
    expect(client.createShipment).not.toHaveBeenCalled();
  });
  it('rechecks current lifecycle inside cancellation job and records refusal', async () => {
    const { service, shipment, attempt, client } = fixture();
    shipment.status = 'CREATED'; shipment.providerDocumentId = remoteId; attempt.operation = 'CANCEL';
    client.getLifecycle.mockResolvedValue({ status: 'REGISTERED', statusDate: '2026-09-13T09:00:00' });
    await expect(service.cancel({ shipmentId: id })).resolves.toBe('IGNORED');
    expect(client.cancelShipment).not.toHaveBeenCalled(); expect(shipment.status).toBe('ACCEPTED');
  });
});

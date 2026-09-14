import { describe, expect, it, vi } from 'vitest';
import { UkrposhtaTrackingError } from '@autosale/integrations';

import { mapUkrposhtaTrackingStatus, UkrposhtaTrackingService } from './ukrposhta-tracking.service.js';

const now = new Date('2026-09-13T12:00:00.000Z');
const shipmentId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';
const generation = '33333333-3333-4333-8333-333333333333';
const credentials = { environment: 'SANDBOX', ecomBearer: 'ecom-secret', counterpartyToken: 'counterparty-secret', trackingBearer: 'tracking-secret', counterpartyUuid: '44444444-4444-4444-8444-444444444444' };

function candidate(input: { status?: string; lifecycle?: string } = {}) {
  return {
    id: attemptId, tenantId: '55555555-5555-4555-8555-555555555555', shipmentId, version: 3,
    status: 'PENDING', attempts: 0, leaseId: null, leaseExpiresAt: null,
    shipment: {
      id: shipmentId, version: 3, provider: 'UKRPOSHTA', status: input.status ?? 'CREATED', trackingNumber: '0500100031143',
      providerDocumentId: '66666666-6666-4666-8666-666666666666', acceptedAt: null, deliveredAt: null,
      providerMetadata: { environment: 'SANDBOX', credentialGenerationId: generation, lifecycle: { status: input.lifecycle ?? 'REGISTERED', statusDate: '2026-09-13T10:00:00' } },
      connection: { id: '77777777-7777-4777-8777-777777777777', status: 'ACTIVE', encryptedCredential: 'cipher', credentialGenerationId: generation },
    },
  };
}

function fixture(rows: ReturnType<typeof candidate>[], claimCount = 1) {
  const tx = {
    shipmentAttempt: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    shipmentStatusEvent: { upsert: vi.fn().mockResolvedValue({}) },
    shipment: { update: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    shipmentAttempt: { findMany: vi.fn().mockResolvedValue(rows), updateMany: vi.fn().mockResolvedValue({ count: claimCount }) },
    $transaction: vi.fn(async (run: (value: typeof tx) => unknown) => run(tx)),
  };
  return { prisma, tx };
}

describe('Ukrposhta tracking mapping v1', () => {
  it('maps documented codes explicitly and treats return-to-sender delivery as returned', () => {
    expect(mapUkrposhtaTrackingStatus('10601', null)).toBe('CREATED');
    expect(mapUkrposhtaTrackingStatus('10100', '1')).toBe('ACCEPTED');
    expect(mapUkrposhtaTrackingStatus('20700', '1')).toBe('IN_TRANSIT');
    expect(mapUkrposhtaTrackingStatus('31200', null)).toBe('RETURNING');
    expect(mapUkrposhtaTrackingStatus('41000', '10')).toBe('RETURNED');
    expect(mapUkrposhtaTrackingStatus('41000', '2')).toBe('DELIVERED');
    expect(mapUkrposhtaTrackingStatus('10600', null)).toBe('CANCELLED');
    expect(mapUkrposhtaTrackingStatus('future-code', null)).toBeNull();
  });
});

describe('UkrposhtaTrackingService', () => {
  it('persists a mapped raw event and advances shipment atomically under its lease', async () => {
    const { prisma, tx } = fixture([candidate()]);
    const occurredAt = new Date('2026-09-13T10:30:00.000Z');
    const raw = { barcode: '0500100031143', step: 4, date: '2026-09-13T13:30:00', event: 41000, eventReason_id: 2 };
    const tracking = { getLastStatuses: vi.fn().mockResolvedValue({ found: [{ barcode: '0500100031143', providerCode: '41000', providerReasonCode: '2', occurredAt, raw }], notFound: [] }) };
    const lifecycle = { getLifecycle: vi.fn() };
    const service = new UkrposhtaTrackingService(prisma as never, () => ({ lifecycle, tracking }), () => JSON.stringify(credentials), () => now);

    await expect(service.processBatch({ shipmentIds: [shipmentId] })).resolves.toBe('UPDATED');
    expect(lifecycle.getLifecycle).not.toHaveBeenCalled();
    expect(tracking.getLastStatuses).toHaveBeenCalledWith(['0500100031143']);
    expect(tx.shipmentStatusEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_shipmentId_providerEventKey: expect.objectContaining({ providerEventKey: expect.stringMatching(/^[0-9a-f]{64}$/) }) },
      create: expect.objectContaining({ status: 'DELIVERED', providerCode: '41000', providerOccurredAt: occurredAt, rawSnapshot: raw, mappingVersion: 1 }),
    }));
    expect(tx.shipment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: shipmentId, tenantId: candidate().tenantId, version: 3, status: 'CREATED' }),
      data: expect.objectContaining({ status: 'DELIVERED', acceptedAt: occurredAt, deliveredAt: occurredAt, nextStatusCheckAt: null, lastProviderCode: '41000', lastErrorCode: null }),
    }));
  });

  it('persists every provider event and derives the current state from the newest event', async () => {
    const { prisma, tx } = fixture([candidate()]);
    const events = [
      { barcode: '0500100031143', providerCode: '41000', providerReasonCode: '2', occurredAt: new Date('2026-09-13T10:30:00.000Z'), raw: { step: 5 } },
      { barcode: '0500100031143', providerCode: '10100', providerReasonCode: null, occurredAt: new Date('2026-09-13T09:30:00.000Z'), raw: { step: 3 } },
      { barcode: '0500100031143', providerCode: '20700', providerReasonCode: null, occurredAt: new Date('2026-09-13T10:00:00.000Z'), raw: { step: 4 } },
    ];
    const tracking = { getLastStatuses: vi.fn().mockResolvedValue({ found: events, notFound: [] }) };
    const service = new UkrposhtaTrackingService(prisma as never, () => ({ lifecycle: { getLifecycle: vi.fn() }, tracking }), () => JSON.stringify(credentials), () => now);

    await expect(service.processBatch({ shipmentIds: [shipmentId] })).resolves.toBe('UPDATED');
    expect(tx.shipmentStatusEvent.upsert).toHaveBeenCalledTimes(3);
    expect(tx.shipment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: 'DELIVERED', lastProviderCode: '41000', acceptedAt: new Date('2026-09-13T09:30:00.000Z'), deliveredAt: new Date('2026-09-13T10:30:00.000Z'),
    }) }));
  });

  it('does not overwrite a shipment changed concurrently while tracking was in flight', async () => {
    const { prisma, tx } = fixture([candidate()]);
    tx.shipment.updateMany.mockResolvedValueOnce({ count: 0 });
    const tracking = { getLastStatuses: vi.fn().mockResolvedValue({ found: [{
      barcode: '0500100031143', providerCode: '41000', providerReasonCode: '2', occurredAt: now, raw: { step: 4 },
    }], notFound: [] }) };
    const service = new UkrposhtaTrackingService(prisma as never, () => ({ lifecycle: { getLifecycle: vi.fn() }, tracking }), () => JSON.stringify(credentials), () => now);

    await expect(service.processBatch({ shipmentIds: [shipmentId] })).resolves.toBe('IGNORED');
    expect(tx.shipment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ version: 3, status: 'CREATED' }) }));
    expect(tx.shipmentStatusEvent.upsert).not.toHaveBeenCalled();
  });

  it('checks eCom lifecycle first and delays tracking while the shipment remains CREATED', async () => {
    const { prisma, tx } = fixture([candidate({ lifecycle: 'CREATED' })]);
    const tracking = { getLastStatuses: vi.fn() };
    const lifecycle = { getLifecycle: vi.fn().mockResolvedValue({ status: 'CREATED', statusDate: '2026-09-13T11:59:00' }) };
    const service = new UkrposhtaTrackingService(prisma as never, () => ({ lifecycle, tracking }), () => JSON.stringify(credentials), () => now);

    await expect(service.processBatch({ shipmentIds: [shipmentId] })).resolves.toBe('UPDATED');
    expect(lifecycle.getLifecycle).toHaveBeenCalledWith('66666666-6666-4666-8666-666666666666');
    expect(tracking.getLastStatuses).not.toHaveBeenCalled();
    expect(tx.shipmentStatusEvent.upsert).not.toHaveBeenCalled();
    expect(tx.shipment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: 'CREATED', lastErrorCode: null, nextStatusCheckAt: new Date('2026-09-13T12:15:00.000Z'),
    }) }));
  });

  it('retains unknown events without regressing the current shipment status', async () => {
    const row = candidate({ status: 'IN_TRANSIT' });
    const { prisma, tx } = fixture([row]);
    const raw = { barcode: '0500100031143', step: 9, date: '2026-09-13T14:00:00', event: 99999, eventReason_id: 1 };
    const tracking = { getLastStatuses: vi.fn().mockResolvedValue({ found: [{ barcode: '0500100031143', providerCode: '99999', providerReasonCode: '1', occurredAt: now, raw }], notFound: [] }) };
    const service = new UkrposhtaTrackingService(prisma as never, () => ({ lifecycle: { getLifecycle: vi.fn() }, tracking }), () => JSON.stringify(credentials), () => now);
    await expect(service.processBatch({ shipmentIds: [shipmentId] })).resolves.toBe('UPDATED');
    expect(tx.shipmentStatusEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ status: null, rawSnapshot: raw }) }));
    expect(tx.shipment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'IN_TRANSIT' }) }));
  });

  it('treats provider not-found after registration as a normal delayed recheck and clears errors', async () => {
    const { prisma, tx } = fixture([candidate()]);
    const tracking = { getLastStatuses: vi.fn().mockResolvedValue({ found: [], notFound: ['0500100031143'] }) };
    const service = new UkrposhtaTrackingService(prisma as never, () => ({ lifecycle: { getLifecycle: vi.fn() }, tracking }), () => JSON.stringify(credentials), () => now);
    await expect(service.processBatch({ shipmentIds: [shipmentId] })).resolves.toBe('UPDATED');
    expect(tx.shipment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: 'ACCEPTED', lastErrorCode: null, nextStatusCheckAt: new Date('2026-09-13T12:30:00.000Z'),
    }) }));
  });

  it('persists physical registration as accepted when tracking is not populated yet', async () => {
    const { prisma, tx } = fixture([candidate({ lifecycle: 'CREATED' })]);
    const registeredAt = '2026-09-13T13:45:00';
    const tracking = { getLastStatuses: vi.fn().mockResolvedValue({ found: [], notFound: ['0500100031143'] }) };
    const lifecycle = { getLifecycle: vi.fn().mockResolvedValue({ status: 'REGISTERED', statusDate: registeredAt }) };
    const service = new UkrposhtaTrackingService(prisma as never, () => ({ lifecycle, tracking }), () => JSON.stringify(credentials), () => now);

    await expect(service.processBatch({ shipmentIds: [shipmentId] })).resolves.toBe('UPDATED');
    expect(tx.shipment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: 'ACCEPTED', acceptedAt: expect.any(Date), lastProviderCode: 'REGISTERED', lastErrorCode: null,
      providerMetadata: expect.objectContaining({ lifecycle: { status: 'REGISTERED', statusDate: registeredAt } }),
    }) }));
  });

  it('does not call either provider when the durable attempt lease is not acquired', async () => {
    const { prisma } = fixture([candidate()], 0);
    const factory = vi.fn();
    const service = new UkrposhtaTrackingService(prisma as never, factory, () => JSON.stringify(credentials), () => now);
    await expect(service.processBatch({ shipmentIds: [shipmentId] })).resolves.toBe('IGNORED');
    expect(factory).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('backs off both the durable attempt and shipment after a retryable tracking failure', async () => {
    const { prisma, tx } = fixture([candidate()]);
    const tracking = { getLastStatuses: vi.fn().mockRejectedValue(new UkrposhtaTrackingError('TIMEOUT', null)) };
    const service = new UkrposhtaTrackingService(prisma as never, () => ({ lifecycle: { getLifecycle: vi.fn() }, tracking }), () => JSON.stringify(credentials), () => now);

    await expect(service.processBatch({ shipmentIds: [shipmentId] })).resolves.toBe('RETRY');
    const retryAt = new Date('2026-09-13T12:05:00.000Z');
    expect(tx.shipmentAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'RETRYABLE', nextAttemptAt: retryAt }) }));
    expect(tx.shipment.update).toHaveBeenCalledWith(expect.objectContaining({ data: { lastErrorCode: 'UKRPOSHTA_TRACKING_TIMEOUT', nextStatusCheckAt: retryAt } }));
  });

  it('stops automatic polling after a terminal tracking authorization failure', async () => {
    const { prisma, tx } = fixture([candidate()]);
    const tracking = { getLastStatuses: vi.fn().mockRejectedValue(new UkrposhtaTrackingError('UNAUTHORIZED', 401)) };
    const service = new UkrposhtaTrackingService(prisma as never, () => ({ lifecycle: { getLifecycle: vi.fn() }, tracking }), () => JSON.stringify(credentials), () => now);

    await expect(service.processBatch({ shipmentIds: [shipmentId] })).resolves.toBe('IGNORED');
    expect(tx.shipmentAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
    expect(tx.shipment.update).toHaveBeenCalledWith(expect.objectContaining({ data: { lastErrorCode: 'UKRPOSHTA_TRACKING_UNAUTHORIZED', nextStatusCheckAt: null } }));
  });
});

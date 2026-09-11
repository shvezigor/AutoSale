import type { AuthPrincipal } from '@autosale/contracts/auth';
import { MetricRegistry, StructuredLogger } from '@autosale/observability';
import { describe, expect, it, vi } from 'vitest';

import { DeliveryController, DeliveryLocationController, ShipmentController, ShipmentLifecycleController } from './delivery.controller.js';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const shipmentId = '44444444-4444-4444-8444-444444444444';
const principalB: AuthPrincipal = {
  userId: '55555555-5555-4555-8555-555555555555', email: 'manager-b@example.com', name: 'Manager B',
  platformRole: 'USER', tenantId: tenantB, membershipRole: 'MANAGER', sessionId: 'session-b',
};
const draft = {
  provider: 'NOVA_POSHTA' as const,
  recipient: { name: 'Олена', phone: '+380671234567' },
  destination: { type: 'BRANCH' as const, cityRef: 'city-ref', locationRef: 'branch-ref', label: 'Відділення №24' },
  parcels: [{ weightKg: 2, lengthCm: 80, widthCm: 20, heightCm: 205 }],
  payer: 'RECIPIENT' as const, declaredValue: 5000, codAmount: null, description: 'Двері',
};

describe('delivery security regression', () => {
  it('derives every delivery resource scope from the authenticated workspace', async () => {
    const delivery = {
      summary: vi.fn().mockResolvedValue({ enabled: true, connections: [] }),
      shipmentOverview: vi.fn().mockResolvedValue({}),
      saveShipmentDraft: vi.fn().mockResolvedValue({}),
      quoteShipment: vi.fn().mockResolvedValue({}),
      createShipment: vi.fn().mockResolvedValue({}),
      shipmentLabel: vi.fn().mockResolvedValue({ bytes: new Uint8Array([37, 80, 68, 70]), filename: 'label.pdf' }),
      cancelShipment: vi.fn().mockResolvedValue({}),
      customerMessagePreview: vi.fn().mockResolvedValue({}),
      sendCustomerMessage: vi.fn().mockResolvedValue({}),
    };
    const locations = { search: vi.fn().mockResolvedValue([]) };
    const connectionController = new DeliveryController(delivery as never);
    const locationController = new DeliveryLocationController(locations as never);
    const shipmentController = new ShipmentController(delivery as never);
    const lifecycleController = new ShipmentLifecycleController(delivery as never);

    await connectionController.summary(principalB);
    await locationController.locations(principalB, { provider: 'NOVA_POSHTA', type: 'CITY', query: 'Луцьк' });
    await shipmentController.overview(principalB, orderId);
    await shipmentController.saveDraft(principalB, orderId, draft);
    await shipmentController.quote(principalB, orderId, draft);
    await shipmentController.create(principalB, orderId, 'stable-key');
    await lifecycleController.label(principalB, shipmentId);
    await lifecycleController.cancel(principalB, shipmentId);
    await lifecycleController.customerMessagePreview(principalB, shipmentId);
    await lifecycleController.sendCustomerMessage(principalB, shipmentId, { text: 'Ваша ТТН 20450000000000' });

    const calls = JSON.stringify({ delivery: Object.values(delivery).flatMap((method) => method.mock.calls), locations: locations.search.mock.calls });
    expect(calls).toContain(tenantB);
    expect(calls).not.toContain(tenantA);
    for (const method of Object.values(delivery)) {
      for (const call of method.mock.calls) expect(call[0]).toBe(tenantB);
    }
    expect(locations.search).toHaveBeenCalledWith(tenantB, expect.any(Object));
  });

  it('redacts delivery credentials and recipient data from structured logs', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger('worker', (line) => lines.push(line));
    logger.warn('shipment_create_failed', {
      shipmentId,
      apiKey: 'np-secret-regression-key',
      customerPhone: '+380671234567',
      deliveryAddress: 'Луцьк, відділення 24',
      providerPayload: { raw: 'provider-private-body' },
      errorCode: 'NOVA_POSHTA_VALIDATION',
    });
    const output = lines.join('\n');
    expect(output).toContain('NOVA_POSHTA_VALIDATION');
    expect(output).not.toMatch(/np-secret-regression-key|\+380671234567|відділення 24|provider-private-body/);
  });

  it('prevents recipient data and resource identifiers from becoming metric labels', () => {
    const metrics = new MetricRegistry();
    expect(() => metrics.increment('autosale_operations_total', { phone: '+380671234567' })).toThrow('Unsupported metric label');
    expect(() => metrics.increment('autosale_operations_total', { address: 'Луцьк' })).toThrow('Unsupported metric label');
    expect(() => metrics.increment('autosale_operations_total', { shipmentId })).toThrow('Unsupported metric label');
    metrics.increment('autosale_operations_total', { operation: 'shipment_create', result: 'success' });
    expect(metrics.render()).toBe('autosale_operations_total{operation="shipment_create",result="success"} 1\n');
  });
});

import type { AuthPrincipal } from '@autosale/contracts/auth';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { NovaPoshtaError } from '@autosale/integrations';

import { DeliveryController, DeliveryLocationController, ShipmentController, ShipmentLifecycleController } from './delivery.controller.js';

const manager: AuthPrincipal = {
  userId: 'manager', email: 'manager@example.com', name: 'Manager', platformRole: 'USER',
  tenantId: 'tenant', membershipRole: 'MANAGER', sessionId: 'session',
};
const owner: AuthPrincipal = { ...manager, userId: 'owner', membershipRole: 'OWNER' };

describe('DeliveryController', () => {
  it('allows managers to read a masked summary', async () => {
    const summary = vi.fn().mockResolvedValue({ enabled: true, connections: [] });
    const controller = new DeliveryController({ summary } as never);
    await expect(controller.summary(manager)).resolves.toEqual({ enabled: true, connections: [] });
    expect(summary).toHaveBeenCalledWith('tenant');
  });

  it('allows only owners to connect, replace or disconnect Nova Poshta', async () => {
    const connect = vi.fn().mockResolvedValue({ provider: 'NOVA_POSHTA', status: 'ACTIVE' });
    const disconnect = vi.fn().mockResolvedValue({ provider: 'NOVA_POSHTA', status: 'DISCONNECTED' });
    const controller = new DeliveryController({ connect, disconnect } as never);

    await expect(controller.connect(manager, { apiKey: 'np-live-key' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(() => controller.disconnect(manager)).toThrow(ForbiddenException);
    await controller.connect(owner, { apiKey: 'np-live-key' });
    await controller.disconnect(owner);
    expect(connect).toHaveBeenCalledWith('tenant', 'owner', { apiKey: 'np-live-key' });
    expect(disconnect).toHaveBeenCalledWith('tenant');
  });

  it('rejects malformed connection and sender-profile payloads', async () => {
    const controller = new DeliveryController({} as never);
    await expect(controller.connect(owner, { apiKey: 'short', extra: true })).rejects.toBeInstanceOf(BadRequestException);
    expect(() => controller.saveSenderProfile(owner, { senderRef: 'sender-ref' })).toThrow(BadRequestException);
  });

  it('returns a safe client error for a rejected provider credential', async () => {
    const connect = vi.fn().mockRejectedValue(new NovaPoshtaError('UNAUTHORIZED', 200));
    const controller = new DeliveryController({ connect } as never);
    await expect(controller.connect(owner, { apiKey: 'np-live-key' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets managers read sender defaults but only owners update them', async () => {
    const senderProfile = vi.fn().mockResolvedValue(null);
    const saveSenderProfile = vi.fn().mockResolvedValue({ senderRef: 'sender-ref' });
    const controller = new DeliveryController({ senderProfile, saveSenderProfile } as never);
    const input = {
      senderRef: 'sender-ref', contactRef: 'contact-ref', contactPhone: '+380501112233',
      origin: { type: 'BRANCH', cityRef: 'city-ref', locationRef: 'branch-ref', label: 'Відділення №1' },
      payer: 'SENDER', defaultParcel: { weightKg: 2, lengthCm: 80, widthCm: 20, heightCm: 20 },
      suggestCustomerNotification: true, customerNotificationTemplate: '{company}: {trackingNumber}',
    };

    await controller.senderProfile(manager);
    expect(() => controller.saveSenderProfile(manager, input)).toThrow(ForbiddenException);
    await controller.saveSenderProfile(owner, input);
    expect(senderProfile).toHaveBeenCalledWith('tenant');
    expect(saveSenderProfile).toHaveBeenCalledWith('tenant', input);
  });

  it('reserves live provider sender choices for owners', async () => {
    const senderOptions = vi.fn().mockResolvedValue([]);
    const controller = new DeliveryController({ senderOptions } as never);
    expect(() => controller.senderOptions(manager)).toThrow(ForbiddenException);
    await expect(controller.senderOptions(owner)).resolves.toEqual([]);
    expect(senderOptions).toHaveBeenCalledWith('tenant');
  });
});

describe('DeliveryLocationController', () => {
  it('validates location search before using the authenticated tenant', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const controller = new DeliveryLocationController({ search } as never);
    await expect(controller.locations(manager, {
      provider: 'NOVA_POSHTA', type: 'CITY', query: 'Луцьк',
    })).resolves.toEqual([]);
    expect(search).toHaveBeenCalledWith('tenant', { provider: 'NOVA_POSHTA', type: 'CITY', query: 'Луцьк' });
    expect(() => controller.locations(manager, { provider: 'NOVA_POSHTA', type: 'BRANCH', query: '22' })).toThrow(BadRequestException);
  });
});

describe('ShipmentController', () => {
  const draft = {
    provider: 'NOVA_POSHTA' as const, recipient: { name: 'Олена', phone: '+380671234567' },
    destination: { type: 'BRANCH' as const, cityRef: 'city-ref', locationRef: 'branch-ref', label: 'Відділення №24' },
    parcels: [{ weightKg: 2, lengthCm: 80, widthCm: 20, heightCm: 205 }], payer: 'RECIPIENT' as const,
    declaredValue: 5000, codAmount: null, description: 'Двері',
  };

  it('scopes overview, draft save and quote to the authenticated tenant and manager', async () => {
    const delivery = { shipmentOverview: vi.fn().mockResolvedValue({}), saveShipmentDraft: vi.fn().mockResolvedValue({}), quoteShipment: vi.fn().mockResolvedValue({ cost: 120 }), createShipment: vi.fn().mockResolvedValue({ status: 'CREATING' }) };
    const controller = new ShipmentController(delivery as never);
    await controller.overview(manager, 'order-id');
    await controller.saveDraft(manager, 'order-id', draft);
    await controller.quote(manager, 'order-id', draft);
    await controller.create(manager, 'order-id', 'create-key');
    expect(delivery.shipmentOverview).toHaveBeenCalledWith('tenant', 'order-id');
    expect(delivery.saveShipmentDraft).toHaveBeenCalledWith('tenant', 'order-id', 'manager', draft);
    expect(delivery.quoteShipment).toHaveBeenCalledWith('tenant', 'order-id', draft);
    expect(delivery.createShipment).toHaveBeenCalledWith('tenant', 'order-id', 'manager', 'create-key');
  });

  it('rejects an incomplete or invalid shipment draft at the boundary', () => {
    const controller = new ShipmentController({} as never);
    expect(() => controller.saveDraft(manager, 'order-id', { ...draft, codAmount: 6000 })).toThrow(BadRequestException);
    expect(() => controller.quote(manager, 'order-id', { ...draft, recipient: { name: '', phone: '123' } })).toThrow(BadRequestException);
  });
});

describe('ShipmentLifecycleController', () => {
  it('loads a tenant-scoped PDF label without exposing a provider URL', async () => {
    const shipmentLabel = vi.fn().mockResolvedValue({ bytes: new Uint8Array([37, 80, 68, 70]), filename: 'nova-poshta-20450000000000.pdf' });
    const result = await new ShipmentLifecycleController({ shipmentLabel } as never).label(manager, 'shipment-id');
    expect(shipmentLabel).toHaveBeenCalledWith('tenant', 'shipment-id');
    expect(result.getHeaders()).toMatchObject({ type: 'application/pdf', disposition: 'attachment; filename="nova-poshta-20450000000000.pdf"' });
  });

  it('queues cancellation in the authenticated tenant scope', async () => {
    const cancelShipment = vi.fn().mockResolvedValue({ status: 'CREATED' });
    await new ShipmentLifecycleController({ cancelShipment } as never).cancel(manager, 'shipment-id');
    expect(cancelShipment).toHaveBeenCalledWith('tenant', 'shipment-id');
  });

  it('previews and explicitly queues a tenant-scoped customer TTN message', async () => {
    const customerMessagePreview = vi.fn().mockResolvedValue({ text: 'Ваша ТТН', alreadySubmitted: false });
    const sendCustomerMessage = vi.fn().mockResolvedValue({ id: 'message-id' });
    const controller = new ShipmentLifecycleController({ customerMessagePreview, sendCustomerMessage } as never);

    await expect(controller.customerMessagePreview(manager, 'shipment-id')).resolves.toMatchObject({ text: 'Ваша ТТН' });
    await expect(controller.sendCustomerMessage(manager, 'shipment-id', { text: '  Ваша ТТН  ' })).resolves.toEqual({ id: 'message-id' });
    expect(customerMessagePreview).toHaveBeenCalledWith('tenant', 'shipment-id');
    expect(sendCustomerMessage).toHaveBeenCalledWith('tenant', 'manager', 'shipment-id', { text: 'Ваша ТТН' });
  });

  it('rejects an empty or unexpected customer message payload', () => {
    const controller = new ShipmentLifecycleController({} as never);
    expect(() => controller.sendCustomerMessage(manager, 'shipment-id', { text: '' })).toThrow(BadRequestException);
    expect(() => controller.sendCustomerMessage(manager, 'shipment-id', { text: 'ТТН', automatic: true })).toThrow(BadRequestException);
  });
});

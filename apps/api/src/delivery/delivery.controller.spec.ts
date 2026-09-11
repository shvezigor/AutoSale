import type { AuthPrincipal } from '@autosale/contracts/auth';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { NovaPoshtaError } from '@autosale/integrations';

import { DeliveryController, DeliveryLocationController } from './delivery.controller.js';

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

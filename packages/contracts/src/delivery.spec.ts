import { describe, expect, it } from 'vitest';

import {
  deliveryConnectionInputSchema,
  deliveryLocationQuerySchema,
  deliveryProviderSchema,
  deliverySenderProfileInputSchema,
  meestConnectionInputSchema,
  shipmentCreateJobSchema,
  shipmentCustomerMessageInputSchema,
  shipmentDraftInputSchema,
  shipmentStatusJobSchema,
  shipmentStatusSchema,
  ukrposhtaConnectionSummarySchema,
} from './delivery.js';
import * as deliveryContracts from './delivery.js';

const validDraft = {
  provider: 'NOVA_POSHTA' as const,
  recipient: { name: 'Ігор Швець', phone: '+380976536783' },
  destination: {
    type: 'BRANCH' as const,
    cityRef: 'city-ref',
    locationRef: 'branch-ref',
    label: 'Відділення №22, вул. Кравчука',
  },
  parcels: [{ weightKg: 2, lengthCm: 80, widthCm: 20, heightCm: 205 }],
  payer: 'RECIPIENT' as const,
  declaredValue: 2_500,
  codAmount: 2_500,
  description: 'Міжкімнатні двері',
};

describe('delivery contracts', () => {
  it('keeps the public provider and shipment status vocabulary closed', () => {
    expect(deliveryProviderSchema.options).toEqual(['NOVA_POSHTA', 'MEEST', 'UKRPOSHTA']);
    expect(shipmentStatusSchema.options).toEqual([
      'DRAFT', 'CREATING', 'CREATED', 'ACCEPTED', 'IN_TRANSIT',
      'DELIVERED', 'RETURNING', 'RETURNED', 'CANCELLED', 'FAILED',
    ]);
    expect(() => deliveryProviderSchema.parse('OTHER')).toThrow();
    expect(() => shipmentStatusSchema.parse('UNKNOWN')).toThrow();
  });

  it('accepts a complete Nova Poshta branch shipment draft', () => {
    expect(shipmentDraftInputSchema.parse(validDraft)).toEqual(validDraft);
  });

  it('accepts an exact address destination without accepting free-form location text', () => {
    const addressDraft = {
      ...validDraft,
      destination: {
        type: 'ADDRESS' as const,
        cityRef: 'city-ref',
        addressRef: 'street-ref',
        building: '12А',
        flat: null,
      },
    };

    expect(shipmentDraftInputSchema.parse(addressDraft)).toEqual(addressDraft);
    expect(() => shipmentDraftInputSchema.parse({
      ...validDraft,
      destination: { type: 'BRANCH', city: 'Луцьк', label: '22 Кравчука' },
    })).toThrow();
  });

  it.each([
    { field: 'recipient phone', value: { ...validDraft, recipient: { ...validDraft.recipient, phone: '0976536783' } } },
    { field: 'zero weight', value: { ...validDraft, parcels: [{ ...validDraft.parcels[0], weightKg: 0 }] } },
    { field: 'negative declared value', value: { ...validDraft, declaredValue: -1 } },
    { field: 'negative COD', value: { ...validDraft, codAmount: -1 } },
    { field: 'multiple parcels', value: { ...validDraft, parcels: [...validDraft.parcels, ...validDraft.parcels] } },
    { field: 'unexpected input', value: { ...validDraft, apiKey: 'must-not-cross-this-boundary' } },
  ])('rejects invalid $field', ({ value }) => {
    expect(() => shipmentDraftInputSchema.parse(value)).toThrow();
  });

  it('accepts only a bounded connection secret and strict sender defaults', () => {
    expect(deliveryConnectionInputSchema.parse({ apiKey: 'np-secret-key' })).toEqual({ apiKey: 'np-secret-key' });
    expect(() => deliveryConnectionInputSchema.parse({ apiKey: '' })).toThrow();
    expect(() => deliveryConnectionInputSchema.parse({ apiKey: 'secret', plaintext: true })).toThrow();

    expect(deliverySenderProfileInputSchema.parse({
      senderRef: 'sender-ref',
      contactRef: 'contact-ref',
      contactPhone: '+380501112233',
      origin: { type: 'BRANCH', cityRef: 'city-ref', locationRef: 'branch-ref', label: 'Відділення №1' },
      payer: 'SENDER',
      defaultParcel: { weightKg: 1, lengthCm: 30, widthCm: 20, heightCm: 10 },
      suggestCustomerNotification: true,
      customerNotificationTemplate: '{company}: ТТН {trackingNumber}',
    })).toMatchObject({ senderRef: 'sender-ref', payer: 'SENDER' });
  });

  it('accepts only complete bounded Meest contract credentials', () => {
    const input = { login: 'merchant', password: 'secret-password', clientUid: '8458f0b0-930f-11e2-a91e-003048d2b473' };
    expect(meestConnectionInputSchema.parse(input)).toEqual(input);
    expect(() => meestConnectionInputSchema.parse({ ...input, password: '' })).toThrow();
    expect(() => meestConnectionInputSchema.parse({ ...input, clientUid: 'client-ref' })).toThrow();
    expect(() => meestConnectionInputSchema.parse({ ...input, apiKey: 'unexpected' })).toThrow();
  });

  it('accepts one complete environment-scoped Ukrposhta credential bundle', () => {
    const schema = (deliveryContracts as unknown as Record<string, { parse(value: unknown): unknown }>).ukrposhtaConnectionInputSchema;
    expect(schema).toBeDefined();
    if (!schema) throw new Error('Ukrposhta connection schema is missing');
    const input = {
      environment: 'SANDBOX',
      ecomBearer: 'ecom-bearer-secret',
      counterpartyToken: 'counterparty-token-secret',
      trackingBearer: 'tracking-bearer-secret',
      counterpartyUuid: '8458f0b0-930f-11e2-a91e-003048d2b473',
    };
    expect(schema.parse(input)).toEqual(input);
    expect(() => schema.parse({ ...input, trackingBearer: '' })).toThrow();
    expect(() => schema.parse({ ...input, environment: 'STAGING' })).toThrow();
    expect(() => schema.parse({ ...input, productionBearer: 'must-not-be-accepted' })).toThrow();
  });

  it('exposes only a safe environment-scoped Ukrposhta connection summary', () => {
    const summary = {
      provider: 'UKRPOSHTA' as const,
      status: 'ACTIVE' as const,
      accountLabel: 'Counterparty • 11111111',
      lastVerifiedAt: '2026-09-12T08:00:00.000Z',
      lastErrorCode: null,
      environment: 'SANDBOX' as const,
      senderProfile: null,
    };
    expect(ukrposhtaConnectionSummarySchema.parse(summary)).toEqual(summary);
    expect(() => ukrposhtaConnectionSummarySchema.parse({
      ...summary,
      ecomBearer: 'must-never-reach-the-browser',
    })).toThrow();
  });

  it('accepts a branch-based Meest sender profile without exposing provider credentials', () => {
    const schema = (deliveryContracts as unknown as Record<string, { parse(value: unknown): unknown }>).meestSenderProfileInputSchema;
    expect(schema).toBeDefined();
    if (!schema) throw new Error('Meest sender profile schema is missing');
    const profile = {
      senderName: 'ТОВ Приклад', senderPhone: '+380501112233',
      origin: { type: 'BRANCH', cityRef: 'city-ref', locationRef: 'branch-ref', label: 'Відділення Meest №1' },
      payer: 'SENDER', defaultParcel: { weightKg: 1, lengthCm: 30, widthCm: 20, heightCm: 10 },
      suggestCustomerNotification: true, customerNotificationTemplate: '{company}: ТТН {trackingNumber}',
    };
    expect(schema.parse(profile)).toEqual(profile);
    expect(() => schema.parse({ ...profile, clientUid: 'must-stay-server-side' })).toThrow();
  });

  it('accepts only UUID-backed delivery worker jobs', () => {
    const shipmentId = '11111111-1111-4111-8111-111111111111';
    expect(shipmentCreateJobSchema.parse({ shipmentId })).toEqual({ shipmentId });
    expect(shipmentStatusJobSchema.parse({ shipmentId })).toEqual({ shipmentId });
    expect(() => shipmentCreateJobSchema.parse({ shipmentId: 'shipment-1' })).toThrow();
    expect(() => shipmentStatusJobSchema.parse({ shipmentId, tenantId: 'must-not-be-trusted' })).toThrow();
  });

  it('accepts only an explicit bounded customer message', () => {
    expect(shipmentCustomerMessageInputSchema.parse({ text: '  Вашу ТТН створено  ' }))
      .toEqual({ text: 'Вашу ТТН створено' });
    expect(() => shipmentCustomerMessageInputSchema.parse({ text: '' })).toThrow();
    expect(() => shipmentCustomerMessageInputSchema.parse({ text: 'x'.repeat(1_001) })).toThrow();
    expect(() => shipmentCustomerMessageInputSchema.parse({ text: 'ТТН', autoSend: true })).toThrow();
  });

  it('accepts only bounded provider-neutral delivery location queries', () => {
    expect(deliveryLocationQuerySchema.parse({
      provider: 'NOVA_POSHTA', type: 'CITY', query: 'Луцьк',
    })).toEqual({ provider: 'NOVA_POSHTA', type: 'CITY', query: 'Луцьк' });
    expect(deliveryLocationQuerySchema.parse({
      provider: 'NOVA_POSHTA', type: 'BRANCH', query: '22', cityRef: 'city-ref',
    })).toMatchObject({ type: 'BRANCH', cityRef: 'city-ref' });
    expect(() => deliveryLocationQuerySchema.parse({ provider: 'NOVA_POSHTA', type: 'CITY', query: 'Л' })).toThrow();
    expect(() => deliveryLocationQuerySchema.parse({ provider: 'NOVA_POSHTA', type: 'BRANCH', query: '22' })).toThrow();
    expect(deliveryLocationQuerySchema.parse({ provider: 'MEEST', type: 'CITY', query: 'Луцьк' }))
      .toEqual({ provider: 'MEEST', type: 'CITY', query: 'Луцьк' });
    expect(deliveryLocationQuerySchema.parse({ provider: 'UKRPOSHTA', type: 'CITY', query: 'Луцьк' })).toMatchObject({ provider: 'UKRPOSHTA' });
  });
});

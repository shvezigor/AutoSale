import { describe, expect, it } from 'vitest';

import {
  deliveryConnectionInputSchema,
  deliveryProviderSchema,
  deliverySenderProfileInputSchema,
  shipmentCreateJobSchema,
  shipmentDraftInputSchema,
  shipmentStatusJobSchema,
  shipmentStatusSchema,
} from './delivery.js';

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

  it('accepts only UUID-backed delivery worker jobs', () => {
    const shipmentId = '11111111-1111-4111-8111-111111111111';
    expect(shipmentCreateJobSchema.parse({ shipmentId })).toEqual({ shipmentId });
    expect(shipmentStatusJobSchema.parse({ shipmentId })).toEqual({ shipmentId });
    expect(() => shipmentCreateJobSchema.parse({ shipmentId: 'shipment-1' })).toThrow();
    expect(() => shipmentStatusJobSchema.parse({ shipmentId, tenantId: 'must-not-be-trusted' })).toThrow();
  });
});

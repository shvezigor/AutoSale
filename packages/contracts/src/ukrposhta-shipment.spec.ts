import { describe, expect, it } from 'vitest';
import { shipmentDraftInputSchema } from './delivery.js';

const draft = {
  provider: 'UKRPOSHTA', recipient: { name: 'Петренко Олена', phone: '+380671234567' },
  destination: { type: 'BRANCH', cityRef: '263:297', locationRef: 'up:1:43000', label: 'Будь-яка назва' },
  parcels: [{ weightKg: 1, lengthCm: 30, widthCm: 20, heightCm: 10 }], payer: 'RECIPIENT',
  declaredValue: 500, codAmount: 400, description: 'Запчастини',
};

describe('Ukrposhta shipment draft', () => {
  it('accepts an explicit carrier and preserves exact branch reference without reading its label', () => {
    expect(shipmentDraftInputSchema.parse(draft)).toEqual(draft);
  });
  it.each([
    { provider: 'MEEST' }, { destination: { ...draft.destination, type: 'PARCEL_LOCKER' } },
    { destination: { ...draft.destination, locationRef: '1' } },
    { destination: { ...draft.destination, locationRef: 'up:1:4300' } },
    { codAmount: 501 }, { recipient: { ...draft.recipient, phone: 'secret' } },
    { parcels: [{ ...draft.parcels[0], weightKg: 0 }] }, { bearer: 'secret' },
  ])('rejects invalid draft %j', (patch) => {
    expect(shipmentDraftInputSchema.safeParse({ ...draft, ...patch }).success).toBe(false);
  });
});

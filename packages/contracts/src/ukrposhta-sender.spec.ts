import { describe, expect, it } from 'vitest';
import * as contracts from './delivery.js';

const profile = {
  senderName: 'ТОВ Приклад', senderPhone: '+380501112233',
  origin: { type: 'BRANCH', cityRef: '263:297', locationRef: '1', label: '43000 · Луцьк 1' },
  payer: 'SENDER', defaultParcel: { weightKg: 1, lengthCm: 30, widthCm: 20, heightCm: 10 },
  suggestCustomerNotification: true, customerNotificationTemplate: '{company}: ТТН {trackingNumber}',
};

describe('Ukrposhta directory and sender contracts', () => {
  it('accepts cities and exact branches but rejects parcel lockers and missing cities', () => {
    expect(contracts.deliveryLocationQuerySchema.safeParse({ provider: 'UKRPOSHTA', type: 'CITY', query: 'Луцьк' }).success).toBe(true);
    expect(contracts.deliveryLocationQuerySchema.safeParse({ provider: 'UKRPOSHTA', type: 'BRANCH', query: '43', cityRef: '263:297' }).success).toBe(true);
    expect(contracts.deliveryLocationQuerySchema.safeParse({ provider: 'UKRPOSHTA', type: 'PARCEL_LOCKER', query: '43', cityRef: '263:297' }).success).toBe(false);
    expect(contracts.deliveryLocationQuerySchema.safeParse({ provider: 'UKRPOSHTA', type: 'BRANCH', query: '43' }).success).toBe(false);
  });

  it('accepts a strict safe profile and rejects credential, UUID, free text and invalid defaults', () => {
    const schema = contracts.ukrposhtaSenderProfileInputSchema;
    expect(schema).toBeDefined();
    expect(schema.parse(profile)).toEqual(profile);
    for (const invalid of [
      { ecomBearer: 'secret' }, { counterpartyUuid: '8458f0b0-930f-11e2-a91e-003048d2b473' }, { senderPhone: '0501112233' },
      { origin: { ...profile.origin, type: 'PARCEL_LOCKER' } }, { origin: { ...profile.origin, locationRef: '' } },
      { defaultParcel: { ...profile.defaultParcel, weightKg: 0 } }, { defaultParcel: { ...profile.defaultParcel, lengthCm: 301 } },
      { customerNotificationTemplate: '' },
    ]) expect(schema.safeParse({ ...profile, ...invalid }).success).toBe(false);
  });

  it('includes only the safe sender profile in strict connection summaries', () => {
    const summary = { provider: 'UKRPOSHTA', status: 'ACTIVE', accountLabel: 'Приклад', lastVerifiedAt: null, lastErrorCode: null, environment: 'SANDBOX', senderProfile: profile };
    expect(contracts.ukrposhtaConnectionSummarySchema.safeParse(summary).success).toBe(true);
    expect(contracts.ukrposhtaConnectionSummarySchema.safeParse({ ...summary, senderProfile: { ...profile, counterpartyUuid: 'secret' } }).success).toBe(false);
  });
});

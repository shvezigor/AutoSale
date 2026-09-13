import { describe, expect, it, vi } from 'vitest';
import * as up from './ukrposhta.js';

const uuid = '11111111-1111-4111-8111-111111111111';
const parcelUuid = '22222222-2222-4222-8222-222222222222';
const credentials = { environment: 'SANDBOX' as const, ecomBearer: 'bearer-secret', counterpartyToken: 'token-secret', trackingBearer: 'tracking-secret', counterpartyUuid: uuid };
const input = { senderUuid: uuid, recipientUuid: parcelUuid, senderAddressId: 10, recipientAddressId: 20, senderPostcode: '01001', recipientPostcode: '43000',
  parcel: { weightKg: 1.25, lengthCm: 30, widthCm: 20, heightCm: 10 }, payer: 'RECIPIENT' as const, declaredValue: 500, codAmount: 400, description: 'Запчастини', clientRef: 'autosale-123' };
const lifecycle = { status: 'CREATED', statusDate: '2026-09-12T10:00:00' };
const shipment = { uuid, barcode: '0500113014256', deliveryPrice: 80.5, parcels: [{ uuid: parcelUuid, barcode: '0500113014256' }], lifecycle };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fixture(responses: Response[], enabled = true, environment: 'SANDBOX' | 'PRODUCTION' = 'SANDBOX') {
  const fetchFn = vi.fn().mockImplementation(async () => { const response = responses.shift(); if (!response) throw new Error('Unexpected provider request'); return response; });
  const client = new up.UkrposhtaClient({ ...credentials, environment, fetch: fetchFn, sandboxShipmentsEnabled: enabled });
  return { client, fetchFn };
}

describe('Ukrposhta eCom boundary', () => {
  it('decodes stable office identity and postcode and rejects labels and path injection', () => {
    expect(typeof up.parseUkrposhtaLocationRef).toBe('function');
    expect(up.parseUkrposhtaLocationRef('up:123:01001')).toEqual({ officeId: '123', postcode: '01001' });
    for (const ref of ['123', '01001 · Київ', 'up:1:1001', 'up:../1:01001']) expect(() => up.parseUkrposhtaLocationRef(ref)).toThrow();
  });
  it('creates and resolves addresses with postcode, bearer, no token and no redirect', async () => {
    const { client, fetchFn } = fixture([json({ id: 10, postcode: '01001' }), json({ id: 10, postcode: '01001' })]);
    expect(typeof client.createAddress).toBe('function');
    await expect(client.createAddress('01001')).resolves.toEqual({ id: 10, postcode: '01001' });
    await expect(client.getAddress(10)).resolves.toEqual({ id: 10, postcode: '01001' });
    expect(fetchFn.mock.calls[0]).toEqual(['https://dev.ukrposhta.ua/ecom/0.0.1/addresses', expect.objectContaining({ method: 'POST', redirect: 'error', body: '{"postcode":"01001"}', headers: expect.objectContaining({ authorization: 'Bearer bearer-secret' }) })]);
  });
  it('creates an individual client with official name fields and resolves by deterministic external ID', async () => {
    const remote = { uuid, externalId: 'autosale-sender-123', addressId: 10 };
    const { client, fetchFn } = fixture([json(remote), json(remote)]);
    expect(typeof client.createClient).toBe('function');
    await expect(client.createClient({ firstName: 'Іван', lastName: 'Петренко', middleName: 'Іванович', phone: '+380671234567', addressId: 10, externalId: 'autosale-sender-123' })).resolves.toEqual(remote);
    await expect(client.findClientByExternalId('autosale-sender-123')).resolves.toEqual(remote);
    expect(JSON.parse(fetchFn.mock.calls[0]![1].body)).toEqual({ type: 'INDIVIDUAL', firstName: 'Іван', lastName: 'Петренко', middleName: 'Іванович', phoneNumber: '+380671234567', addressId: 10, externalId: 'autosale-sender-123' });
    expect(fetchFn.mock.calls[1]![0]).toBe('https://dev.ukrposhta.ua/ecom/0.0.1/clients/external-id/autosale-sender-123?token=token-secret');
  });
  it('sends exact eCom fields, converts kg to grams and returns only safe shipment metadata', async () => {
    const { client, fetchFn } = fixture([json({ ...shipment, sender: { name: 'private', token: 'secret' } })]);
    expect(typeof client.createShipment).toBe('function');
    await expect(client.createShipment(input)).resolves.toEqual(shipment);
    expect(fetchFn.mock.calls[0]![0]).toBe('https://dev.ukrposhta.ua/ecom/0.0.1/shipments?token=token-secret');
    expect(JSON.parse(fetchFn.mock.calls[0]![1].body)).toEqual({ type: 'STANDARD', sender: { uuid }, recipient: { uuid: parcelUuid }, senderAddressId: 10, recipientAddressId: 20, dropOffPostcode: '01001', deliveryType: 'W2W', paidByRecipient: true, postPayPaidByRecipient: true, postPay: 400, onFailReceiveType: 'RETURN', description: 'Запчастини', externalId: 'autosale-123', parcels: [{ weight: 1250, length: 30, width: 20, height: 10, declaredPrice: 500, description: 'Запчастини' }] });
  });
  it.each([[false, 'SANDBOX'], [true, 'PRODUCTION']] as const)('blocks disabled or production creates before fetch (%s %s)', async (enabled, environment) => {
    const { client, fetchFn } = fixture([], enabled, environment);
    expect(typeof client.createShipment).toBe('function');
    await expect(client.createShipment(input)).rejects.toMatchObject({ code: 'CREATION_DISABLED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('obtains a side-effect-free estimate without creating remote objects', async () => {
    const { client, fetchFn } = fixture([json({ deliveryPrice: 80.5 })], false);
    expect(typeof client.calculateShipment).toBe('function');
    await expect(client.calculateShipment(input)).resolves.toEqual({ cost: 80.5, currency: 'UAH', estimatedDeliveryDate: null });
    expect(new URL(fetchFn.mock.calls[0]![0]).pathname).toBe('/ecom/0.0.1/domestic/delivery-price');
    expect(JSON.parse(fetchFn.mock.calls[0]![1].body)).toMatchObject({ addressFrom: { postcode: '01001' }, addressTo: { postcode: '43000' }, type: 'STANDARD', deliveryType: 'W2W', validate: true });
    expect(fetchFn).toHaveBeenCalledOnce();
  });
  it('gets UUID, barcode and lifecycle using fixed official production URLs', async () => {
    const { client, fetchFn } = fixture([json(shipment), json(shipment), json({ shipmentUuid: uuid, shipmentBarcode: shipment.barcode, ...lifecycle })], false, 'PRODUCTION');
    expect(typeof client.getShipment).toBe('function');
    await expect(client.getShipment(uuid)).resolves.toEqual(shipment);
    await expect(client.getShipmentByBarcode(shipment.barcode)).resolves.toEqual(shipment);
    await expect(client.getLifecycle(uuid)).resolves.toEqual(lifecycle);
    expect(fetchFn.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([`/ecom/0.0.1/shipments/${uuid}`, '/ecom/0.0.1/shipments/barcode/0500113014256', `/ecom/0.0.1/shipments/${uuid}/lifecycle`]);
    expect(fetchFn.mock.calls.every(([url, init]) => new URL(url).origin === 'https://www.ukrposhta.ua' && init.redirect === 'error')).toBe(true);
  });
  it('rechecks CREATED before update/delete and identifies the parcel to update', async () => {
    const life = { shipmentUuid: uuid, shipmentBarcode: shipment.barcode, ...lifecycle };
    const { client, fetchFn } = fixture([json(life), json(shipment), json(life), new Response(null, { status: 200 })]);
    expect(typeof client.updateShipment).toBe('function');
    await expect(client.updateShipment(uuid, { description: 'Новий опис', parcelUuid, parcel: input.parcel, declaredValue: 500 })).resolves.toEqual(shipment);
    await expect(client.cancelShipment(uuid)).resolves.toEqual({ cancelled: true });
    expect(JSON.parse(fetchFn.mock.calls[1]![1].body).parcels[0].uuid).toBe(parcelUuid);
    expect(fetchFn.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'PUT', 'GET', 'DELETE']);
  });
  it.each(['REGISTERED', 'DELIVERED', 'NEW_STATE'])('refuses lifecycle %s before delete', async (status) => {
    const { client, fetchFn } = fixture([json({ shipmentUuid: uuid, shipmentBarcode: shipment.barcode, ...lifecycle, status })]);
    expect(typeof client.cancelShipment).toBe('function');
    await expect(client.cancelShipment(uuid)).rejects.toMatchObject({ code: status === 'NEW_STATE' ? 'INVALID_RESPONSE' : 'LIFECYCLE_CONFLICT' });
    expect(fetchFn).toHaveBeenCalledOnce();
  });
  it('proxies bounded PDF bytes through the official forms host', async () => {
    const { client, fetchFn } = fixture([new Response('%PDF-1.4\n%%EOF', { headers: { 'content-type': 'application/pdf' } })]);
    expect(typeof client.getLabel).toBe('function');
    expect(new TextDecoder().decode(await client.getLabel(uuid))).toBe('%PDF-1.4\n%%EOF');
    expect(fetchFn.mock.calls[0]![0]).toBe(`https://dev.ukrposhta.ua/forms/ecom/0.0.1/shipments/${uuid}/sticker?token=token-secret`);
  });
  it.each(['type', 'signature', 'size'])('rejects unsafe PDF %s', async (failure) => {
    const { client } = fixture([new Response(failure === 'signature' ? 'personal data' : '%PDF-1.4', { headers: { 'content-type': failure === 'type' ? 'text/html' : 'application/pdf', ...(failure === 'size' ? { 'content-length': '10485761' } : {}) } })]);
    expect(typeof client.getLabel).toBe('function');
    await expect(client.getLabel(uuid)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it.each([[401, 'UNAUTHORIZED'], [404, 'NOT_FOUND'], [429, 'RATE_LIMITED'], [400, 'VALIDATION'], [503, 'PROVIDER_ERROR']] as const)('bounds HTTP %s errors', async (status, code) => {
    const { client } = fixture([json({ token: 'secret', name: 'private' }, status)]);
    expect(typeof client.getShipment).toBe('function');
    await expect(client.getShipment(uuid)).rejects.toMatchObject({ code, message: `Ukrposhta API request failed (${code})` });
  });
  it.each(['uuid', 'barcode', 'price', 'lifecycle', 'parcels'])('rejects malformed shipment %s', async (field) => {
    const bad = { ...shipment, ...(field === 'price' ? { deliveryPrice: -1 } : { [field]: 'private' }) };
    const { client } = fixture([json(bad)]);
    expect(typeof client.getShipment).toBe('function');
    await expect(client.getShipment(uuid)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('never retries an ambiguous POST and reports unknown create without provider details', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new DOMException('token-secret', 'TimeoutError'));
    const client = new up.UkrposhtaClient({ ...credentials, fetch: fetchFn, sandboxShipmentsEnabled: true });
    expect(typeof client.createShipment).toBe('function');
    await expect(client.createShipment(input)).rejects.toMatchObject({ code: 'UNKNOWN_CREATE' });
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from 'vitest';

import { NovaPoshtaClient, NovaPoshtaError } from './nova-poshta.js';

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data, errors: [], warnings: [], info: [] }), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

const shipment = {
  sender: {
    cityRef: 'sender-city',
    locationRef: 'sender-branch',
    counterpartyRef: 'sender-ref',
    contactRef: 'sender-contact',
    phone: '+380501112233',
  },
  recipient: {
    name: 'Ігор Швець',
    phone: '+380976536783',
    cityRef: 'recipient-city',
    cityLabel: 'Луцьк',
    locationRef: 'recipient-branch',
    locationNumber: '22',
  },
  parcel: { weightKg: 2, lengthCm: 80, widthCm: 20, heightCm: 20 },
  payer: 'RECIPIENT' as const,
  declaredValue: 2500,
  codAmount: 2500,
  description: 'Двері',
  clientRef: 'shipment-123',
};

describe('NovaPoshtaClient', () => {
  it('uses the official request envelope and maps cities', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok([{ Ref: 'city-ref', Description: 'Луцьк', AreaDescription: 'Волинська' }]));
    const client = new NovaPoshtaClient({ apiKey: 'secret-key', fetch: fetchFn });

    await expect(client.searchCities(' Луцьк ')).resolves.toEqual([
      { ref: 'city-ref', label: 'Луцьк', areaLabel: 'Волинська' },
    ]);

    expect(fetchFn).toHaveBeenCalledWith('https://api.novaposhta.ua/v2.0/json/', expect.objectContaining({
      method: 'POST',
      signal: expect.any(AbortSignal),
      body: JSON.stringify({
        apiKey: 'secret-key',
        modelName: 'Address',
        calledMethod: 'getCities',
        methodProperties: { FindByString: 'Луцьк', Limit: '20', Page: '1' },
      }),
    }));
  });

  it('validates the credential and maps sender profiles without exposing the key', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(ok([{ Ref: 'sender-ref' }]))
      .mockResolvedValueOnce(ok([{ Ref: 'sender-ref', Description: 'ТОВ Приклад', EDRPOU: '12345678' }]))
      .mockResolvedValueOnce(ok([{ Ref: 'contact-ref', Description: 'Ігор Швець', Phones: '380501112233' }]))
      .mockResolvedValueOnce(ok([{ Ref: 'branch-ref', CityRef: 'city-ref', Description: 'Відділення №1', Number: '1', CategoryOfWarehouse: 'Branch' }]));
    const client = new NovaPoshtaClient({ apiKey: 'secret-key', fetch: fetchFn });

    await expect(client.validateCredential()).resolves.toEqual({ valid: true });
    const profiles = await client.listSenderProfiles();
    expect(profiles).toEqual([
      {
        ref: 'sender-ref', label: 'ТОВ Приклад', edrpou: '12345678',
        contacts: [{ ref: 'contact-ref', label: 'Ігор Швець', phone: '+380501112233' }],
        origins: [{ ref: 'branch-ref', cityRef: 'city-ref', label: 'Відділення №1', number: '1', type: 'BRANCH' }],
      },
    ]);
    expect(JSON.parse(String(fetchFn.mock.calls[2]?.[1]?.body))).toMatchObject({
      modelName: 'Counterparty', calledMethod: 'getCounterpartyContactPersons', methodProperties: { Ref: 'sender-ref' },
    });
    expect(JSON.parse(String(fetchFn.mock.calls[3]?.[1]?.body))).toMatchObject({
      modelName: 'Counterparty', calledMethod: 'getCounterpartyAddresses', methodProperties: { Ref: 'sender-ref', CounterpartyProperty: 'Sender' },
    });
    expect(JSON.stringify(profiles)).not.toContain('secret-key');
  });

  it('maps branches and parcel lockers from the warehouse directory', async () => {
    const client = new NovaPoshtaClient({
      apiKey: 'secret-key',
      fetch: vi.fn().mockResolvedValue(ok([
        { Ref: 'branch-ref', CityRef: 'city-ref', Description: 'Відділення №22', Number: '22', CategoryOfWarehouse: 'Branch' },
        { Ref: 'locker-ref', CityRef: 'city-ref', Description: 'Поштомат №1001', Number: '1001', CategoryOfWarehouse: 'Postomat' },
      ])),
    });

    await expect(client.searchLocations({ cityRef: 'city-ref', query: '22' })).resolves.toEqual([
      { ref: 'branch-ref', cityRef: 'city-ref', label: 'Відділення №22', number: '22', type: 'BRANCH' },
      { ref: 'locker-ref', cityRef: 'city-ref', label: 'Поштомат №1001', number: '1001', type: 'PARCEL_LOCKER' },
    ]);
  });

  it('maps quotes, client-reference lookup, create, status, label and cancellation', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(ok([{ Cost: '120.50', EstimatedDeliveryDate: '12.09.2026' }]))
      .mockResolvedValueOnce(ok([{ Ref: 'doc-ref', IntDocNumber: '20450000000000', InfoRegClientBarcodes: 'shipment-123' }]))
      .mockResolvedValueOnce(ok([{ Ref: 'doc-ref', IntDocNumber: '20450000000000', CostOnSite: '125' }]))
      .mockResolvedValueOnce(ok([{ Number: '20450000000000', StatusCode: '4', Status: 'Відправлення у місті відправника' }]))
      .mockResolvedValueOnce(ok([{ Content: 'JVBERi0xLjQ=' }]))
      .mockResolvedValueOnce(ok([{ Ref: 'doc-ref' }]));
    const client = new NovaPoshtaClient({ apiKey: 'secret-key', fetch: fetchFn });

    await expect(client.calculateShipment(shipment)).resolves.toEqual({
      currency: 'UAH', cost: 120.5, estimatedDeliveryDate: '2026-09-12',
    });
    await expect(client.findShipmentByClientRef('shipment-123')).resolves.toEqual({
      documentRef: 'doc-ref', trackingNumber: '20450000000000', clientRef: 'shipment-123',
    });
    await expect(client.createShipment(shipment)).resolves.toEqual({
      documentRef: 'doc-ref', trackingNumber: '20450000000000', cost: 125,
    });
    const createRequest = JSON.parse(String(fetchFn.mock.calls[2]?.[1]?.body)) as {
      modelName: string;
      calledMethod: string;
      methodProperties: Record<string, unknown>;
    };
    expect(createRequest).toMatchObject({
      modelName: 'InternetDocument',
      calledMethod: 'save',
      methodProperties: {
        InfoRegClientBarcodes: 'shipment-123',
        RecipientWarehouseRef: 'recipient-branch',
        RecipientsPhone: '380976536783',
        PayerType: 'Recipient',
      },
    });
    await expect(client.getShipmentStatus('20450000000000')).resolves.toEqual({
      trackingNumber: '20450000000000', providerCode: '4', providerLabel: 'Відправлення у місті відправника',
    });
    await expect(client.getLabel('doc-ref')).resolves.toEqual(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]));
    await expect(client.cancelShipment('doc-ref')).resolves.toEqual({ cancelled: true });
  });

  it('rejects a create response without both document identifiers', async () => {
    const client = new NovaPoshtaClient({ apiKey: 'secret-key', fetch: vi.fn().mockResolvedValue(ok([{ Ref: 'doc-ref' }])) });
    await expect(client.createShipment(shipment)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('reports an ambiguous create timeout without leaking request data', async () => {
    const client = new NovaPoshtaClient({
      apiKey: 'secret-key',
      fetch: vi.fn().mockRejectedValue(new DOMException('unknown create outcome', 'TimeoutError')),
    });
    const error = await client.createShipment(shipment).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'TIMEOUT', status: null });
    expect(String(error)).not.toContain('shipment-123');
    expect(String(error)).not.toContain('secret-key');
  });

  it.each([
    [401, { success: false, data: [], errors: ['API key secret-key invalid'] }, 'UNAUTHORIZED'],
    [429, { success: false, data: [], errors: ['too many requests'] }, 'RATE_LIMITED'],
    [200, { success: false, data: [], errors: ['Validation failed for secret-key'] }, 'VALIDATION'],
  ] as const)('maps provider failure %s to a safe code', async (status, payload, code) => {
    const client = new NovaPoshtaClient({
      apiKey: 'secret-key',
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status })),
    });
    const error = await client.searchCities('Луцьк').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NovaPoshtaError);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain('secret-key');
    expect(String(error)).not.toContain('Validation failed');
  });

  it('rejects malformed JSON and malformed data', async () => {
    const malformedJson = new NovaPoshtaClient({ apiKey: 'secret-key', fetch: vi.fn().mockResolvedValue(new Response('{', { status: 200 })) });
    await expect(malformedJson.searchCities('Луцьк')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const malformedData = new NovaPoshtaClient({ apiKey: 'secret-key', fetch: vi.fn().mockResolvedValue(ok({ Ref: 'not-an-array' })) });
    await expect(malformedData.searchCities('Луцьк')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('separates timeouts from network failures', async () => {
    const timeout = new NovaPoshtaClient({
      apiKey: 'secret-key',
      fetch: vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')),
    });
    await expect(timeout.searchCities('Луцьк')).rejects.toMatchObject({ code: 'TIMEOUT', status: null });

    const network = new NovaPoshtaClient({ apiKey: 'secret-key', fetch: vi.fn().mockRejectedValue(new Error('socket secret-key')) });
    const error = await network.searchCities('Луцьк').catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'NETWORK', status: null });
    expect(String(error)).not.toContain('socket');
    expect(String(error)).not.toContain('secret-key');
  });
});

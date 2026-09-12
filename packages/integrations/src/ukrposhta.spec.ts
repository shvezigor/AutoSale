import { describe, expect, it, vi } from 'vitest';

import * as integrations from './index.js';

const credentials = {
  environment: 'SANDBOX' as const,
  ecomBearer: 'ecom-bearer-secret',
  counterpartyToken: 'counterparty-token-secret',
  trackingBearer: 'tracking-bearer-secret',
  counterpartyUuid: '8458f0b0-930f-11e2-a91e-003048d2b473',
};

describe('UkrposhtaClient', () => {
  it('searches Ukrainian cities using the fixed classifier host and eCom bearer', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ Entries: { Entry: { CITY_ID: 297, REGION_ID: '263', CITY_UA: 'Луцьк', REGION_UA: 'Волинська' } } })));
    const client = new integrations.UkrposhtaClient({ ...credentials, fetch: fetchFn });
    expect(typeof client.searchCities).toBe('function');
    await expect(client.searchCities(' Луцьк ')).resolves.toEqual([{ ref: '263:297', label: 'Луцьк, Волинська' }]);
    const url = new URL(fetchFn.mock.calls[0]![0]);
    expect(url.origin + url.pathname).toBe('https://www.ukrposhta.ua/address-classifier-ws/get_city_by_region_id_and_district_id_and_city_ua');
    expect(url.searchParams.get('city_ua')).toBe('Луцьк');
    expect(url.searchParams.has('token')).toBe(false);
    expect(fetchFn.mock.calls[0]![1]).toMatchObject({ redirect: 'error', headers: { authorization: 'Bearer ecom-bearer-secret', accept: 'application/json' }, signal: expect.any(AbortSignal) });
  });

  it('keeps stable active office identities and filters every unavailable capability', async () => {
    const office = { ID: '1', CITY_ID: '297', REGION_ID: '263', POSTINDEX: '43000', PO_SHORT: 'Луцьк 1', ADDRESS: 'вул. Кривий Вал, 19', LOCK_CODE: '0', AVALIBLE: '1', IS_NODISTRICT: '0', IS_NOLETTERS: '0', ISVPZ: '1', IS_SECURITY: '0' };
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ Entries: { Entry: [office,
      ...[{ LOCK_CODE: '1' }, { AVALIBLE: '0' }, { IS_NODISTRICT: '1' }, { IS_NOLETTERS: '1' }].map((flag) => ({ ...office, ...flag })),
      { ...office, CITY_ID: '999' },
    ] } })));
    const client = new integrations.UkrposhtaClient({ ...credentials, fetch: fetchFn });
    expect(typeof client.searchLocations).toBe('function');
    await expect(client.searchLocations({ cityRef: '263:297', type: 'BRANCH', query: '430' })).resolves.toEqual([{ ref: '1', cityRef: '263:297', type: 'BRANCH', label: '43000 · Луцьк 1 · вул. Кривий Вал, 19', number: '43000' }]);
    expect(new URL(fetchFn.mock.calls[0]![0]).searchParams.get('city_id')).toBe('297');
    expect(new URL(fetchFn.mock.calls[0]![0]).searchParams.get('region_id')).toBe('263');
  });

  it.each([429, 500, 503, 'network', 'empty'])('retries transient %s at most three times with backoff', async (failure) => {
    const fetchFn = vi.fn().mockImplementation(() => failure === 'network' ? Promise.reject(new Error('secret')) : Promise.resolve(failure === 'empty' ? new Response(JSON.stringify({ Entries: { Entry: [] } })) : new Response('secret', { status: failure as number })));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new integrations.UkrposhtaClient({ ...credentials, fetch: fetchFn, sleep });
    expect(typeof client.searchCities).toBe('function');
    if (failure === 'empty') await expect(client.searchCities('Луцьк')).resolves.toEqual([]);
    else await expect(client.searchCities('Луцьк')).rejects.toThrow(/^Ukrposhta API request failed \([A-Z_]+\)$/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([200, 400]);
  });

  it.each([401, 403, 400, 'json', 'envelope', 'record'])('does not retry unsafe or malformed %s responses', async (failure) => {
    const fetchFn = vi.fn().mockImplementation(() => Promise.resolve(typeof failure === 'number' ? new Response('credential secret', { status: failure }) : new Response(failure === 'json' ? '<secret>' : JSON.stringify(failure === 'envelope' ? { secret: 'body' } : { Entries: { Entry: { CITY_ID: '297', CITY_UA: {} } } }))));
    const sleep = vi.fn();
    const client = new integrations.UkrposhtaClient({ ...credentials, fetch: fetchFn, sleep });
    expect(typeof client.searchCities).toBe('function');
    await expect(client.searchCities('Луцьк')).rejects.toThrow(/^Ukrposhta API request failed \([A-Z_]+\)$/);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('times out abortable attempts and rejects invalid directory input before fetch', async () => {
    const fetchFn = vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('secret', 'AbortError')))));
    const client = new integrations.UkrposhtaClient({ ...credentials, fetch: fetchFn, timeoutMs: 5, sleep: async () => {} });
    expect(typeof client.searchCities).toBe('function');
    await expect(client.searchCities('Луцьк')).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    fetchFn.mockClear();
    await expect(client.searchCities('Л')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(client.searchLocations({ cityRef: '', type: 'BRANCH', query: '22' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(client.searchLocations({ cityRef: '297', type: 'PARCEL_LOCKER', query: '22' })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('validates the counterparty through the official sandbox eCom endpoint', async () => {
    const Client = (integrations as unknown as { UkrposhtaClient?: new (config: unknown) => { validateCredential(): Promise<unknown> } }).UkrposhtaClient;
    expect(Client).toBeDefined();
    if (!Client) throw new Error('UkrposhtaClient is missing');
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ uuid: credentials.counterpartyUuid, name: 'ТОВ Приклад' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const client = new Client({ ...credentials, fetch: fetchFn });

    await expect(client.validateCredential()).resolves.toEqual({
      valid: true,
      accountLabel: 'ТОВ Приклад · тестове середовище',
      environment: 'SANDBOX',
    });
    const requestUrl = new URL(String(fetchFn.mock.calls[0]?.[0]));
    expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe(`https://dev.ukrposhta.ua/ecom/0.0.1/clients/${credentials.counterpartyUuid}`);
    expect(requestUrl.searchParams.get('token')).toBe(credentials.counterpartyToken);
    expect(fetchFn.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ authorization: `Bearer ${credentials.ecomBearer}`, accept: 'application/json' }),
      signal: expect.any(AbortSignal),
    }));
  });

  it('accepts a version-7 counterparty UUID already accepted by the connection contract', async () => {
    const Client = (integrations as unknown as { UkrposhtaClient?: new (config: unknown) => { validateCredential(): Promise<unknown> } }).UkrposhtaClient;
    expect(Client).toBeDefined();
    if (!Client) throw new Error('UkrposhtaClient is missing');
    const counterpartyUuid = '8458f0b0-930f-71e2-a91e-003048d2b473';
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ uuid: counterpartyUuid, name: 'ТОВ Приклад' }), { status: 200 }));

    const client = new Client({ ...credentials, counterpartyUuid, fetch: fetchFn });

    await expect(client.validateCredential()).resolves.toMatchObject({ valid: true, environment: 'SANDBOX' });
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});

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
});

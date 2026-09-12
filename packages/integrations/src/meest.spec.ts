import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { MeestClient, MeestError } from './meest.js';

const clientUid = '8458f0b0-930f-11e2-a91e-003048d2b473';

const success = (items: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?>
  <return><result_table>${items}</result_table><errors><code>000</code><name></name></errors></return>`, {
  status: 200,
  headers: { 'content-type': 'text/xml' },
});

describe('MeestClient', () => {
  it('uses the official HTTPS query envelope, signs it and maps cities', async () => {
    const fetchFn = vi.fn().mockResolvedValue(success(`
      <items><uuid>city-ref</uuid><DescriptionUA>Луцьк</DescriptionUA><RegionDescriptionUA>Волинська</RegionDescriptionUA></items>
    `));
    const client = new MeestClient({ login: 'merchant', password: 'secret-password', clientUid, fetch: fetchFn });

    await expect(client.searchCities(' Луцьк ')).resolves.toEqual([
      { ref: 'city-ref', label: 'Луцьк', areaLabel: 'Волинська' },
    ]);

    const where = "DescriptionUA like 'Луцьк%'";
    const expectedSign = createHash('md5').update(`merchantsecret-passwordCity${where}`).digest('hex');
    const request = String(fetchFn.mock.calls[0]?.[1]?.body);
    expect(fetchFn).toHaveBeenCalledWith('https://api1c.meest-group.com/services/1C_Query.php', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'text/xml; charset=utf-8' },
      signal: expect.any(AbortSignal),
    }));
    expect(request).toContain('<login>merchant</login>');
    expect(request).toContain('<function>City</function>');
    expect(request).toContain(`<sign>${expectedSign}</sign>`);
    expect(request).not.toContain('secret-password');
  });

  it('escapes provider filters and maps branches', async () => {
    const fetchFn = vi.fn().mockResolvedValue(success(`
      <items><UUID>branch-ref</UUID><CityUUID>city-ref</CityUUID><DescriptionUA>Відділення №1</DescriptionUA><BranchCode>1</BranchCode><Branchtype>МППВ</Branchtype></items>
    `));
    const client = new MeestClient({ login: 'merchant', password: 'secret-password', clientUid, fetch: fetchFn });

    await expect(client.searchLocations({ cityRef: 'city-ref', query: "№1'", type: 'BRANCH' })).resolves.toEqual([
      { ref: 'branch-ref', cityRef: 'city-ref', label: 'Відділення №1', number: '1', type: 'BRANCH' },
    ]);
    const request = String(fetchFn.mock.calls[0]?.[1]?.body);
    expect(request).toContain('CityUUID = &apos;city-ref&apos;');
    expect(request).toContain('DescriptionUA like &apos;%№1&apos;&apos;%&apos;');
  });

  it('validates credentials without returning them', async () => {
    const client = new MeestClient({
      login: 'merchant', password: 'secret-password', clientUid,
      fetch: vi.fn().mockResolvedValue(success('<items><uuid>city-ref</uuid><DescriptionUA>Київ</DescriptionUA></items>')),
    });
    await expect(client.validateCredential()).resolves.toEqual({ valid: true, accountLabel: 'merchant' });
  });

  it.each([
    ['101', 'UNAUTHORIZED'],
    ['108', 'VALIDATION'],
    ['110', 'NETWORK'],
  ] as const)('maps provider code %s to a safe error', async (providerCode, code) => {
    const response = new Response(`<return><result_table></result_table><errors><code>${providerCode}</code><name>secret-password rejected</name></errors></return>`, { status: 200 });
    const client = new MeestClient({ login: 'merchant', password: 'secret-password', clientUid, fetch: vi.fn().mockResolvedValue(response) });
    const error = await client.searchCities('Луцьк').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MeestError);
    expect(error).toMatchObject({ code, status: 200 });
    expect(String(error)).not.toContain('secret-password');
  });

  it('rejects malformed XML, timeouts and insecure endpoint overrides', async () => {
    const malformed = new MeestClient({ login: 'merchant', password: 'secret-password', clientUid, fetch: vi.fn().mockResolvedValue(new Response('<return>')) });
    await expect(malformed.searchCities('Луцьк')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const timeout = new MeestClient({
      login: 'merchant', password: 'secret-password', clientUid,
      fetch: vi.fn().mockRejectedValue(new DOMException('secret-password', 'TimeoutError')),
    });
    await expect(timeout.searchCities('Луцьк')).rejects.toMatchObject({ code: 'TIMEOUT', status: null });
    expect(() => new MeestClient({
      login: 'merchant', password: 'secret-password', clientUid, queryEndpoint: 'http://api1c.meest-group.com/services/1C_Query.php',
    })).toThrow('HTTPS');
    expect(() => new MeestClient({
      login: 'merchant', password: 'secret-password', clientUid, queryEndpoint: 'https://example.com/collect',
    })).toThrow('official Meest host');
  });
});

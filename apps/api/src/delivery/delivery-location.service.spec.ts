import { describe, expect, it, vi } from 'vitest';

import { DeliveryLocationService } from './delivery-location.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

function fixture() {
  let currentTime = 1_000;
  const searchCities = vi.fn().mockResolvedValue([
    { ref: 'city-ref', label: 'Луцьк', areaLabel: 'Волинська' },
  ]);
  const searchLocations = vi.fn().mockResolvedValue([
    { ref: 'branch-ref', cityRef: 'city-ref', label: 'Відділення №22', number: '22', type: 'BRANCH' },
  ]);
  const clientContextForTenant = vi.fn().mockResolvedValue({
    credentialGenerationId: 'generation-1',
    client: { searchCities, searchLocations },
  });
  const service = new DeliveryLocationService(
    { clientContextForTenant } as never,
    { now: () => currentTime, maxEntries: 2, ttlMs: 300_000 },
  );
  return { service, searchCities, searchLocations, clientContextForTenant, advance: (ms: number) => { currentTime += ms; } };
}

describe('DeliveryLocationService', () => {
  it('normalizes and caps provider city results', async () => {
    const { service, searchCities } = fixture();
    searchCities.mockResolvedValue(Array.from({ length: 55 }, (_, index) => ({
      ref: `city-${index}`, label: `Місто ${index}`, areaLabel: null,
    })));

    const result = await service.search(tenantId, { provider: 'NOVA_POSHTA', type: 'CITY', query: '  ЛУЦЬК  ' });

    expect(searchCities).toHaveBeenCalledWith('ЛУЦЬК');
    expect(result).toHaveLength(50);
    expect(result[0]).toEqual({ ref: 'city-0', provider: 'NOVA_POSHTA', type: 'CITY', label: 'Місто 0' });
  });

  it('requires the active tenant connection before contacting the provider', async () => {
    const { service, clientContextForTenant, searchCities } = fixture();
    clientContextForTenant.mockRejectedValue(new Error('inactive'));
    await expect(service.search(tenantId, { provider: 'NOVA_POSHTA', type: 'CITY', query: 'Луцьк' })).rejects.toThrow('inactive');
    expect(searchCities).not.toHaveBeenCalled();
  });

  it('reuses a five-minute cache without exposing mutable cached arrays', async () => {
    const { service, searchCities, advance } = fixture();
    const input = { provider: 'NOVA_POSHTA' as const, type: 'CITY' as const, query: 'Луцьк' };
    const first = await service.search(tenantId, input);
    first[0]!.label = 'mutated';
    const second = await service.search(tenantId, input);
    expect(second[0]?.label).toBe('Луцьк');
    expect(searchCities).toHaveBeenCalledOnce();
    advance(300_001);
    await service.search(tenantId, input);
    expect(searchCities).toHaveBeenCalledTimes(2);
  });

  it('separates credential generations and does not cache rejected calls', async () => {
    const { service, clientContextForTenant, searchCities } = fixture();
    const input = { provider: 'NOVA_POSHTA' as const, type: 'CITY' as const, query: 'Луцьк' };
    searchCities.mockRejectedValueOnce(new Error('temporary'));
    await expect(service.search(tenantId, input)).rejects.toThrow('temporary');
    await service.search(tenantId, input);
    clientContextForTenant.mockResolvedValue({ credentialGenerationId: 'generation-2', client: { searchCities, searchLocations: vi.fn() } });
    await service.search(tenantId, input);
    expect(searchCities).toHaveBeenCalledTimes(3);
  });

  it('searches branches and parcel lockers within an exact city', async () => {
    const { service, searchLocations } = fixture();
    const result = await service.search(tenantId, {
      provider: 'NOVA_POSHTA', type: 'BRANCH', query: '22', cityRef: 'city-ref',
    });
    expect(searchLocations).toHaveBeenCalledWith({ cityRef: 'city-ref', type: 'BRANCH', query: '22' });
    expect(result).toEqual([{ ref: 'branch-ref', provider: 'NOVA_POSHTA', type: 'BRANCH', label: 'Відділення №22', cityRef: 'city-ref', number: '22' }]);
  });
});

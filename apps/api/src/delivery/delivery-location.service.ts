import type { DeliveryLocation, DeliveryLocationQuery } from '@autosale/contracts';
import type { MeestCity, MeestLocation, NovaPoshtaCity, NovaPoshtaLocation } from '@autosale/integrations';

import type { DeliveryService } from './delivery.service.js';
import type { MeestConnectionService } from './meest-connection.service.js';

type CacheEntry = { expiresAt: number; values: DeliveryLocation[] };

type LocationServiceOptions = {
  now?: () => number;
  ttlMs?: number;
  maxEntries?: number;
};

export class DeliveryLocationService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(
    private readonly delivery: Pick<DeliveryService, 'clientContextForTenant'>,
    private readonly meest: Pick<MeestConnectionService, 'clientContextForTenant'>,
    options: LocationServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 300_000;
    this.maxEntries = options.maxEntries ?? 1_000;
  }

  async search(tenantId: string, input: DeliveryLocationQuery): Promise<DeliveryLocation[]> {
    const query = normalizeQuery(input.query);
    const context = input.provider === 'MEEST'
      ? await this.meest.clientContextForTenant(tenantId)
      : await this.delivery.clientContextForTenant(tenantId);
    const key = [tenantId, context.credentialGenerationId, input.provider, input.type, input.cityRef ?? '', query.toLocaleLowerCase('uk-UA')].join(':');
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cloneLocations(cached.values);
    if (cached) this.cache.delete(key);

    const values = input.type === 'CITY'
      ? (await context.client.searchCities(query)).slice(0, 50).map((city) => cityLocation(input.provider, city))
      : (await context.client.searchLocations({ cityRef: input.cityRef!, type: input.type, query })).slice(0, 50).map((location) => providerLocation(input.provider, location));

    this.remember(key, values);
    return cloneLocations(values);
  }

  private remember(key: string, values: DeliveryLocation[]): void {
    while (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
    this.cache.set(key, { expiresAt: this.now() + this.ttlMs, values: cloneLocations(values) });
  }
}

function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function cityLocation(provider: 'NOVA_POSHTA' | 'MEEST', city: NovaPoshtaCity | MeestCity): DeliveryLocation {
  return { ref: city.ref, provider, type: 'CITY', label: city.label };
}

function providerLocation(provider: 'NOVA_POSHTA' | 'MEEST', location: NovaPoshtaLocation | MeestLocation): DeliveryLocation {
  return {
    ref: location.ref,
    provider,
    type: location.type,
    label: location.label,
    cityRef: location.cityRef,
    number: location.number,
  };
}

function cloneLocations(values: DeliveryLocation[]): DeliveryLocation[] {
  return values.map((value) => ({ ...value }));
}

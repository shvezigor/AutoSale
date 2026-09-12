export type UkrposhtaEnvironment = 'SANDBOX' | 'PRODUCTION';

export type UkrposhtaErrorCode =
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'INVALID_RESPONSE'
  | 'PROVIDER_ERROR';

export interface UkrposhtaClientConfig {
  environment: UkrposhtaEnvironment;
  ecomBearer: string;
  counterpartyToken: string;
  trackingBearer: string;
  counterpartyUuid: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface UkrposhtaCity { ref: string; label: string }
export interface UkrposhtaLocation { ref: string; cityRef: string; type: 'BRANCH'; label: string; number?: string }

export class UkrposhtaError extends Error {
  constructor(readonly code: UkrposhtaErrorCode, readonly status: number | null) {
    super(`Ukrposhta API request failed (${code})`);
    this.name = 'UkrposhtaError';
  }
}

export class UkrposhtaClient {
  private readonly config: Omit<UkrposhtaClientConfig, 'fetch' | 'timeoutMs' | 'sleep'>;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: UkrposhtaClientConfig) {
    this.config = {
      environment: environment(config.environment),
      ecomBearer: credential(config.ecomBearer),
      counterpartyToken: credential(config.counterpartyToken),
      trackingBearer: credential(config.trackingBearer),
      counterpartyUuid: uuid(config.counterpartyUuid),
    };
    this.fetchFn = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async searchCities(query: string): Promise<UkrposhtaCity[]> {
    const name = searchQuery(query);
    const rows = await this.classifier('get_city_by_region_id_and_district_id_and_city_ua', { city_ua: name });
    return rows.map((row) => ({
      // The office endpoint also requires region_id. Keep it in the opaque public reference.
      ref: `${identifier(row.REGION_ID)}:${identifier(row.CITY_ID)}`,
      label: [requiredText(row.CITY_UA), optionalText(row.DISTRICT_UA), optionalText(row.REGION_UA)].filter(Boolean).join(', ').slice(0, 240),
    })).slice(0, 50);
  }

  async searchLocations(input: { cityRef: string; type: 'BRANCH' | 'PARCEL_LOCKER'; query: string }): Promise<UkrposhtaLocation[]> {
    const query = searchQuery(input.query).toLocaleLowerCase('uk-UA');
    const parts = /^(\d{1,20}):(\d{1,20})$/.exec(input.cityRef);
    if (input.type !== 'BRANCH' || !parts) throw new UkrposhtaError('VALIDATION', null);
    const rows = await this.classifier('get_postoffices_by_city_id', { region_id: parts[1]!, city_id: parts[2]! });
    return rows.flatMap((row): UkrposhtaLocation[] => {
      if (!deliverable(row)) return [];
      const cityId = identifier(row.CITY_ID);
      const regionId = identifier(row.REGION_ID);
      if (cityId !== parts[2] || regionId !== parts[1]) return [];
      const ref = identifier(row.ID);
      const number = optionalText(row.POSTINDEX);
      const label = [number, requiredText(row.PO_SHORT), optionalText(row.ADDRESS)].filter(Boolean).join(' · ').slice(0, 240);
      if (!label.toLocaleLowerCase('uk-UA').includes(query)) return [];
      return [{ ref, cityRef: input.cityRef, type: 'BRANCH', label, ...(number ? { number } : {}) }];
    }).slice(0, 50);
  }

  private async classifier(endpoint: string, params: Record<string, string>): Promise<Record<string, unknown>[]> {
    const url = new URL(endpoint, 'https://www.ukrposhta.ua/address-classifier-ws/');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await this.sleep(200 * 2 ** (attempt - 1));
      try {
        let response: Response;
        try {
          response = await this.fetchFn(url.toString(), {
            method: 'GET', redirect: 'error',
            headers: { authorization: `Bearer ${this.config.ecomBearer}`, accept: 'application/json' },
            signal: AbortSignal.timeout(this.timeoutMs),
          });
        } catch (error) {
          const name = error instanceof Error ? error.name : '';
          throw new UkrposhtaError(name === 'AbortError' || name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK', null);
        }
        if (!response.ok) throw httpError(response.status);
        const rows = classifierEntries(await safeJson(response));
        if (rows.length || attempt === 2) return rows;
      } catch (error) {
        if (!(error instanceof UkrposhtaError)) throw new UkrposhtaError('INVALID_RESPONSE', null);
        if (attempt === 2 || !['RATE_LIMITED', 'PROVIDER_ERROR', 'NETWORK', 'TIMEOUT'].includes(error.code)) throw error;
      }
    }
    return [];
  }

  async validateCredential(): Promise<{ valid: true; accountLabel: string; environment: UkrposhtaEnvironment }> {
    const base = this.config.environment === 'SANDBOX'
      ? 'https://dev.ukrposhta.ua/ecom/0.0.1/'
      : 'https://www.ukrposhta.ua/ecom/0.0.1/';
    const url = new URL(`clients/${this.config.counterpartyUuid}`, base);
    url.searchParams.set('token', this.config.counterpartyToken);
    let response: Response;
    try {
      response = await this.fetchFn(url.toString(), {
        method: 'GET',
        headers: { authorization: `Bearer ${this.config.ecomBearer}`, accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      throw new UkrposhtaError(name === 'AbortError' || name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK', null);
    }
    if (!response.ok) throw httpError(response.status);
    const payload = await safeJson(response);
    if (!isRecord(payload) || typeof payload.uuid !== 'string') {
      throw new UkrposhtaError('INVALID_RESPONSE', response.status);
    }
    const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : 'Контрагент Укрпошти';
    const suffix = this.config.environment === 'SANDBOX' ? 'тестове середовище' : 'бойове середовище';
    return { valid: true, accountLabel: `${name} · ${suffix}`, environment: this.config.environment };
  }
}

function environment(value: string): UkrposhtaEnvironment {
  if (value !== 'SANDBOX' && value !== 'PRODUCTION') throw new Error('Invalid Ukrposhta environment');
  return value;
}

function credential(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 2_048) throw new Error('Invalid Ukrposhta credential');
  return normalized;
}

function uuid(value: string): string {
  const normalized = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error('Invalid Ukrposhta counterparty UUID');
  }
  return normalized;
}

function httpError(status: number): UkrposhtaError {
  if (status === 401 || status === 403) return new UkrposhtaError('UNAUTHORIZED', status);
  if (status === 404) return new UkrposhtaError('NOT_FOUND', status);
  if (status === 429) return new UkrposhtaError('RATE_LIMITED', status);
  return new UkrposhtaError(status >= 500 ? 'PROVIDER_ERROR' : 'VALIDATION', status);
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new UkrposhtaError('INVALID_RESPONSE', response.status);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function searchQuery(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < 2 || normalized.length > 120) throw new UkrposhtaError('VALIDATION', null);
  return normalized;
}

function classifierEntries(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload) || !isRecord(payload.Entries) || !('Entry' in payload.Entries)) throw new UkrposhtaError('INVALID_RESPONSE', null);
  const entry = payload.Entries.Entry;
  if (entry === null) return [];
  const rows = Array.isArray(entry) ? entry : [entry];
  if (rows.length > 10_000 || !rows.every(isRecord)) throw new UkrposhtaError('INVALID_RESPONSE', null);
  return rows;
}

function identifier(value: unknown): string {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^\d{1,20}$/.test(text)) throw new UkrposhtaError('INVALID_RESPONSE', null);
  return text;
}

function optionalText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string' || value.length > 2_000) throw new UkrposhtaError('INVALID_RESPONSE', null);
  return value.trim();
}

function requiredText(value: unknown): string {
  const text = optionalText(value);
  if (!text) throw new UkrposhtaError('INVALID_RESPONSE', null);
  return text;
}

function deliverable(row: Record<string, unknown>): boolean {
  if (row.LOCK_CODE !== '0' && row.LOCK_CODE !== 0) return false;
  for (const field of ['IS_NODISTRICT', 'IS_NOLETTERS', 'IS_SECURITY', 'RESTRICTED_ACCESS']) {
    if (row[field] != null && row[field] !== '0' && row[field] !== 0 && row[field] !== false) return false;
  }
  for (const field of ['AVALIBLE', 'ISVPZ']) {
    if (row[field] != null && row[field] !== '1' && row[field] !== 1 && row[field] !== true) return false;
  }
  return true;
}

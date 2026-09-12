import { createHash } from 'node:crypto';

import { XMLParser, XMLValidator } from 'fast-xml-parser';

export type MeestErrorCode =
  | 'UNAUTHORIZED'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'INVALID_RESPONSE'
  | 'PROVIDER_ERROR';

export interface MeestClientConfig {
  login: string;
  password: string;
  clientUid: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  queryEndpoint?: string;
}

export interface MeestCity {
  ref: string;
  label: string;
  areaLabel: string | null;
}

export interface MeestLocation {
  ref: string;
  cityRef: string;
  label: string;
  number: string;
  type: 'BRANCH' | 'PARCEL_LOCKER';
}

export interface MeestLocationSearchInput {
  cityRef: string;
  query?: string;
  type?: 'BRANCH' | 'PARCEL_LOCKER';
}

export class MeestError extends Error {
  constructor(readonly code: MeestErrorCode, readonly status: number | null) {
    super(`Meest API request failed (${code})`);
    this.name = 'MeestError';
  }
}

export class MeestClient {
  private readonly login: string;
  private readonly password: string;
  private readonly clientUid: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly queryEndpoint: string;

  constructor(config: MeestClientConfig) {
    this.login = boundedCredential(config.login, 128, 'login');
    this.password = boundedCredential(config.password, 256, 'password');
    this.clientUid = providerRef(config.clientUid);
    this.fetchFn = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.queryEndpoint = secureEndpoint(config.queryEndpoint ?? 'https://api1c.meest-group.com/services/1C_Query.php');
  }

  async validateCredential(): Promise<{ valid: true; accountLabel: string }> {
    await this.query('City', "DescriptionUA = 'Київ'");
    return { valid: true, accountLabel: this.login };
  }

  async searchCities(query: string): Promise<MeestCity[]> {
    const normalized = boundedText(query, 2, 120);
    const rows = await this.query('City', `DescriptionUA like '${providerFilter(normalized)}%'`);
    return rows.map((row) => ({
      ref: requiredString(row.uuid ?? row.UUID),
      label: requiredString(row.DescriptionUA),
      areaLabel: optionalString(row.RegionDescriptionUA),
    }));
  }

  async searchLocations(input: MeestLocationSearchInput): Promise<MeestLocation[]> {
    const cityRef = providerRef(input.cityRef);
    const query = input.query?.trim() ?? '';
    if (query.length > 120) throw new Error('Invalid Meest location query');
    const where = `CityUUID = '${providerFilter(cityRef)}'${query ? ` and DescriptionUA like '%${providerFilter(query)}%'` : ''}`;
    const rows = await this.query('Branch', where);
    const locations = rows.map((row) => ({
      ref: requiredString(row.UUID ?? row.uuid),
      cityRef: requiredString(row.CityUUID ?? row.Cityuuid),
      label: requiredString(row.DescriptionUA),
      number: optionalString(row.BranchCode) ?? '',
      type: locationType(row),
    }));
    return input.type ? locations.filter((location) => location.type === input.type) : locations;
  }

  get accountRef(): string {
    return this.clientUid;
  }

  private async query(functionName: string, where: string, order = ''): Promise<Array<Record<string, unknown>>> {
    const sign = createHash('md5').update(`${this.login}${this.password}${functionName}${where}${order}`).digest('hex');
    const body = `<?xml version="1.0" encoding="UTF-8"?><param><login>${escapeXml(this.login)}</login><function>${escapeXml(functionName)}</function><where>${escapeXml(where)}</where><order>${escapeXml(order)}</order><sign>${sign}</sign></param>`;
    let response: Response;
    try {
      response = await this.fetchFn(this.queryEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'text/xml; charset=utf-8' },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const name = isRecord(error) && typeof error.name === 'string' ? error.name : '';
      throw new MeestError(name === 'AbortError' || name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK', null);
    }
    const xml = await response.text();
    if (!response.ok) throw httpError(response.status);
    return parseResponse(xml, response.status);
  }
}

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  processEntities: false,
  trimValues: true,
});

function parseResponse(xml: string, status: number): Array<Record<string, unknown>> {
  if (XMLValidator.validate(xml) !== true) throw new MeestError('INVALID_RESPONSE', status);
  let payload: unknown;
  try {
    payload = parser.parse(xml);
  } catch {
    throw new MeestError('INVALID_RESPONSE', status);
  }
  if (!isRecord(payload) || !isRecord(payload.return)) throw new MeestError('INVALID_RESPONSE', status);
  const root = payload.return;
  const errors = isRecord(root.errors) ? root.errors : null;
  const providerCode = errors ? optionalString(errors.code) : null;
  if (providerCode && providerCode !== '000') throw providerError(providerCode, status);
  if (!isRecord(root.result_table) && root.result_table !== '') throw new MeestError('INVALID_RESPONSE', status);
  if (!isRecord(root.result_table)) return [];
  const rawItems = root.result_table.items;
  if (rawItems === undefined || rawItems === '') return [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];
  if (!items.every(isRecord)) throw new MeestError('INVALID_RESPONSE', status);
  return items;
}

function providerError(code: string, status: number): MeestError {
  if (code === '101') return new MeestError('UNAUTHORIZED', status);
  if (code === '100' || code === '110') return new MeestError('NETWORK', status);
  if (code === '111') return new MeestError('RATE_LIMITED', status);
  if (['102', '103', '104', '105', '108', '109'].includes(code)) return new MeestError('VALIDATION', status);
  return new MeestError('PROVIDER_ERROR', status);
}

function httpError(status: number): MeestError {
  if (status === 401 || status === 403) return new MeestError('UNAUTHORIZED', status);
  if (status === 429) return new MeestError('RATE_LIMITED', status);
  return new MeestError(status >= 500 ? 'PROVIDER_ERROR' : 'VALIDATION', status);
}

function secureEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Meest endpoint must use HTTPS');
  }
  if (url.protocol !== 'https:') throw new Error('Meest endpoint must use HTTPS');
  if (url.hostname !== 'api1c.meest-group.com') throw new Error('Meest endpoint must use the official Meest host');
  return url.toString();
}

function boundedCredential(value: string, max: number, name: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`Invalid Meest ${name}`);
  return normalized;
}

function boundedText(value: string, min: number, max: number): string {
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) throw new Error('Invalid Meest search query');
  return normalized;
}

function providerRef(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9-]{1,128}$/.test(normalized)) throw new Error('Invalid Meest provider reference');
  return normalized;
}

function providerFilter(value: string): string {
  return value.replaceAll("'", "''");
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function locationType(row: Record<string, unknown>): 'BRANCH' | 'PARCEL_LOCKER' {
  const category = `${optionalString(row.Branchtype) ?? ''} ${optionalString(row.DescriptionUA) ?? ''}`.toLowerCase();
  return /поштомат|postomat|parcel.?locker/.test(category) ? 'PARCEL_LOCKER' : 'BRANCH';
}

function requiredString(value: unknown): string {
  const normalized = optionalString(value);
  if (!normalized) throw new MeestError('INVALID_RESPONSE', 200);
  return normalized;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

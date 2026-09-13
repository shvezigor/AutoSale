export type UkrposhtaEnvironment = 'SANDBOX' | 'PRODUCTION';

export type UkrposhtaErrorCode =
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'INVALID_RESPONSE'
  | 'UNKNOWN_CREATE'
  | 'CREATION_DISABLED'
  | 'LIFECYCLE_CONFLICT'
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
  sandboxShipmentsEnabled?: boolean;
}

export interface UkrposhtaCity { ref: string; label: string }
export interface UkrposhtaLocation { ref: string; cityRef: string; type: 'BRANCH'; label: string; number?: string }

export interface UkrposhtaParcel { weightKg: number; lengthCm: number; widthCm: number; heightCm: number }
export interface UkrposhtaQuoteInput {
  senderPostcode: string; recipientPostcode: string; parcel: UkrposhtaParcel;
  declaredValue: number; codAmount: number | null;
}
export interface UkrposhtaShipmentInput extends UkrposhtaQuoteInput {
  senderUuid: string; recipientUuid: string; senderAddressId: number; recipientAddressId: number;
  payer: 'SENDER' | 'RECIPIENT'; description: string; clientRef: string;
}
export interface UkrposhtaClientInput {
  firstName: string; lastName: string; middleName?: string; phone: string; addressId: number; externalId: string;
}
export interface UkrposhtaRemoteClient { uuid: string; externalId: string; addressId: number }
export interface UkrposhtaLifecycle {
  status: 'CREATED' | 'REGISTERED' | 'DELIVERED' | 'IN_DEPARTMENT' | 'DELIVERING' | 'FORWARDING' | 'RETURNING' | 'RETURNED' | 'STORAGE' | 'CANCELED' | 'DELETED';
  statusDate: string;
}
export interface UkrposhtaShipment {
  uuid: string; barcode: string; deliveryPrice: number;
  parcels: Array<{ uuid: string; barcode: string }>;
  lifecycle: UkrposhtaLifecycle;
}

/** Version 1 opaque office reference: stable classifier ID and five-digit postcode, never a display label. */
export function parseUkrposhtaLocationRef(ref: string): { officeId: string; postcode: string } {
  const parts = /^up:(\d{1,20}):(\d{5})$/.exec(ref);
  if (!parts) throw new UkrposhtaError('VALIDATION', null);
  return { officeId: parts[1]!, postcode: parts[2]! };
}

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
      sandboxShipmentsEnabled: config.sandboxShipmentsEnabled === true,
    };
    this.fetchFn = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async createAddress(postcode: string): Promise<{ id: number; postcode: string }> {
    checkPostcode(postcode);
    const result = addressResponse(await this.jsonRequest('addresses', 'POST', { postcode }, false));
    if (result.postcode !== postcode) throw new UkrposhtaError('INVALID_RESPONSE', null);
    return result;
  }

  async getAddress(id: number): Promise<{ id: number; postcode: string }> {
    checkId(id);
    const result = addressResponse(await this.jsonRequest(`addresses/${id}`, 'GET', undefined, false));
    if (result.id !== id) throw new UkrposhtaError('INVALID_RESPONSE', null);
    return result;
  }

  async createClient(input: UkrposhtaClientInput): Promise<UkrposhtaRemoteClient> {
    checkText(input.firstName, 2, 250); checkText(input.lastName, 2, 250);
    if (input.middleName !== undefined) checkText(input.middleName, 2, 250);
    checkId(input.addressId); checkExternalId(input.externalId);
    if (!/^\+380\d{9}$/.test(input.phone)) throw new UkrposhtaError('VALIDATION', null);
    return clientResponse(await this.jsonRequest('clients', 'POST', {
      type: 'INDIVIDUAL', firstName: input.firstName, lastName: input.lastName,
      ...(input.middleName ? { middleName: input.middleName } : {}),
      phoneNumber: input.phone, addressId: input.addressId, externalId: input.externalId,
    }));
  }

  async findClientByExternalId(externalId: string): Promise<UkrposhtaRemoteClient | null> {
    checkExternalId(externalId);
    try {
      const result = clientResponse(await this.jsonRequest(`clients/external-id/${externalId}`));
      if (result.externalId !== externalId) throw new UkrposhtaError('INVALID_RESPONSE', null);
      return result;
    }
    catch (error) { if (error instanceof UkrposhtaError && error.code === 'NOT_FOUND') return null; throw error; }
  }

  async calculateShipment(input: UkrposhtaQuoteInput): Promise<{ cost: number; currency: 'UAH'; estimatedDeliveryDate: null }> {
    const parcel = parcelRequest(input.parcel, input.declaredValue);
    checkPostcode(input.senderPostcode); checkPostcode(input.recipientPostcode); checkCod(input.codAmount, input.declaredValue);
    const body = await this.jsonRequest('domestic/delivery-price', 'POST', {
      addressFrom: { postcode: input.senderPostcode }, addressTo: { postcode: input.recipientPostcode },
      type: 'STANDARD', deliveryType: 'W2W', validate: true, weight: parcel.weight, length: parcel.length,
      parcels: [parcel], declaredPrice: input.declaredValue, postPay: input.codAmount,
    }, false);
    if (!isRecord(body)) throw new UkrposhtaError('INVALID_RESPONSE', null);
    return { cost: responseMoney(body.deliveryPrice), currency: 'UAH', estimatedDeliveryDate: null };
  }

  async createShipment(input: UkrposhtaShipmentInput): Promise<UkrposhtaShipment> {
    if (this.config.environment !== 'SANDBOX' || !this.config.sandboxShipmentsEnabled) throw new UkrposhtaError('CREATION_DISABLED', null);
    const parcel = parcelRequest(input.parcel, input.declaredValue);
    checkUuid(input.senderUuid); checkUuid(input.recipientUuid); checkId(input.senderAddressId); checkId(input.recipientAddressId);
    checkPostcode(input.senderPostcode); checkPostcode(input.recipientPostcode); checkCod(input.codAmount, input.declaredValue);
    checkText(input.description, 1, 100); checkExternalId(input.clientRef);
    if (!['SENDER', 'RECIPIENT'].includes(input.payer)) throw new UkrposhtaError('VALIDATION', null);
    try {
      return shipmentResponse(await this.jsonRequest('shipments', 'POST', {
        type: 'STANDARD', sender: { uuid: input.senderUuid }, recipient: { uuid: input.recipientUuid },
        senderAddressId: input.senderAddressId, recipientAddressId: input.recipientAddressId, dropOffPostcode: input.senderPostcode,
        deliveryType: 'W2W', paidByRecipient: input.payer === 'RECIPIENT', postPayPaidByRecipient: input.payer === 'RECIPIENT',
        postPay: input.codAmount, onFailReceiveType: 'RETURN', description: input.description, externalId: input.clientRef,
        parcels: [{ ...parcel, description: input.description }],
      }));
    } catch (error) {
      if (error instanceof UkrposhtaError && ['TIMEOUT', 'NETWORK', 'PROVIDER_ERROR', 'INVALID_RESPONSE'].includes(error.code)) throw new UkrposhtaError('UNKNOWN_CREATE', error.status);
      throw error;
    }
  }

  async getShipment(id: string): Promise<UkrposhtaShipment> {
    checkUuid(id);
    const result = shipmentResponse(await this.jsonRequest(`shipments/${id}`));
    if (result.uuid !== id) throw new UkrposhtaError('INVALID_RESPONSE', null);
    return result;
  }

  async getShipmentByBarcode(barcode: string): Promise<UkrposhtaShipment> {
    checkBarcode(barcode);
    const result = shipmentResponse(await this.jsonRequest(`shipments/barcode/${barcode}`));
    if (result.barcode !== barcode && !result.parcels.some((parcel) => parcel.barcode === barcode)) throw new UkrposhtaError('INVALID_RESPONSE', null);
    return result;
  }

  async getLifecycle(id: string): Promise<UkrposhtaLifecycle> {
    checkUuidOrBarcode(id);
    const body = await this.jsonRequest(`shipments/${id}/lifecycle`);
    if (!isRecord(body) || body.shipmentUuid !== id && body.shipmentBarcode !== id) throw new UkrposhtaError('INVALID_RESPONSE', null);
    return lifecycleResponse(body);
  }

  async updateShipment(id: string, input: { description: string; parcelUuid: string; parcel: UkrposhtaParcel; declaredValue: number }): Promise<UkrposhtaShipment> {
    checkUuid(id); checkUuid(input.parcelUuid); checkText(input.description, 1, 100);
    const parcel = parcelRequest(input.parcel, input.declaredValue);
    if ((await this.getLifecycle(id)).status !== 'CREATED') throw new UkrposhtaError('LIFECYCLE_CONFLICT', null);
    return shipmentResponse(await this.jsonRequest(`shipments/${id}`, 'PUT', { description: input.description, parcels: [{ uuid: input.parcelUuid, ...parcel }] }));
  }

  async cancelShipment(id: string): Promise<{ cancelled: true }> {
    checkUuid(id);
    if ((await this.getLifecycle(id)).status !== 'CREATED') throw new UkrposhtaError('LIFECYCLE_CONFLICT', null);
    const response = await this.request(`shipments/${id}`, 'DELETE');
    if ((await boundedBody(response, 1024)).byteLength !== 0) throw new UkrposhtaError('INVALID_RESPONSE', response.status);
    return { cancelled: true };
  }

  async getLabel(id: string): Promise<Uint8Array> {
    checkUuidOrBarcode(id);
    const response = await this.request(`shipments/${id}/sticker`, 'GET', undefined, true, true);
    if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/pdf') throw new UkrposhtaError('INVALID_RESPONSE', response.status);
    const bytes = await boundedBody(response, 10 * 1024 * 1024);
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new UkrposhtaError('INVALID_RESPONSE', response.status);
    return bytes;
  }

  private async jsonRequest(path: string, method = 'GET', body?: unknown, token = true): Promise<unknown> {
    const response = await this.request(path, method, body, token);
    if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new UkrposhtaError('INVALID_RESPONSE', response.status);
    const bytes = await boundedBody(response, 1024 * 1024);
    try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
    catch { throw new UkrposhtaError('INVALID_RESPONSE', response.status); }
  }

  private async request(path: string, method: string, body?: unknown, token = true, forms = false): Promise<Response> {
    const host = this.config.environment === 'SANDBOX' ? 'https://dev.ukrposhta.ua/' : 'https://www.ukrposhta.ua/';
    const url = new URL(`${forms ? 'forms/' : ''}ecom/0.0.1/${path}`, host);
    if (token) url.searchParams.set('token', this.config.counterpartyToken);
    let response: Response;
    try {
      response = await this.fetchFn(url.toString(), {
        method, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
        headers: { authorization: `Bearer ${this.config.ecomBearer}`, accept: forms ? 'application/pdf' : 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) { throw transportError(error); }
    if (!response.ok) throw httpError(response.status);
    return response;
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
      const officeId = identifier(row.ID);
      const number = optionalText(row.POSTINDEX);
      if (!/^\d{5}$/.test(number)) throw new UkrposhtaError('INVALID_RESPONSE', null);
      const ref = `up:${officeId}:${number}`;
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
        redirect: 'error',
        headers: { authorization: `Bearer ${this.config.ecomBearer}`, accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      throw new UkrposhtaError(name === 'AbortError' || name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK', null);
    }
    if (!response.ok) throw httpError(response.status);
    const payload = await safeJson(response);
    if (!isRecord(payload) || payload.uuid !== this.config.counterpartyUuid) {
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
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') {
      throw new UkrposhtaError('TIMEOUT', response.status);
    }
    if (error instanceof TypeError) {
      throw new UkrposhtaError('NETWORK', response.status);
    }
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

function checkText(value: unknown, min: number, max: number): asserts value is string {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new UkrposhtaError('VALIDATION', null);
}
function checkPostcode(value: string): void {
  if (!/^\d{5}$/.test(value)) throw new UkrposhtaError('VALIDATION', null);
}
function checkUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new UkrposhtaError('VALIDATION', null);
}
function checkBarcode(value: string): void {
  if (!/^\d{13}$/.test(value)) throw new UkrposhtaError('VALIDATION', null);
}
function checkUuidOrBarcode(value: string): void { if (/^\d{13}$/.test(value)) return; checkUuid(value); }
function checkId(value: number): void { if (!Number.isSafeInteger(value) || value <= 0) throw new UkrposhtaError('VALIDATION', null); }
function checkExternalId(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new UkrposhtaError('VALIDATION', null);
}
function checkCod(cod: number | null, declared: number): void {
  if (cod !== null && (!Number.isFinite(cod) || cod < 0 || cod > declared)) throw new UkrposhtaError('VALIDATION', null);
}
function parcelRequest(parcel: UkrposhtaParcel, declaredValue: number) {
  if (!Number.isFinite(declaredValue) || declaredValue <= 0 || declaredValue > 10_000_000 ||
    !Number.isFinite(parcel.weightKg) || parcel.weightKg <= 0 || parcel.weightKg > 1_000 ||
    [parcel.lengthCm, parcel.widthCm, parcel.heightCm].some((n) => !Number.isFinite(n) || n <= 0 || n > 300)) throw new UkrposhtaError('VALIDATION', null);
  return { weight: Math.ceil(parcel.weightKg * 1000), length: Math.ceil(parcel.lengthCm), width: Math.ceil(parcel.widthCm), height: Math.ceil(parcel.heightCm), declaredPrice: declaredValue };
}
function responseMoney(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10_000_000) throw new UkrposhtaError('INVALID_RESPONSE', null);
  return value;
}
function validatedResponse<T>(run: () => T): T {
  try { return run(); } catch { throw new UkrposhtaError('INVALID_RESPONSE', null); }
}
function addressResponse(body: unknown): { id: number; postcode: string } {
  return validatedResponse(() => {
    if (!isRecord(body) || typeof body.id !== 'number' || typeof body.postcode !== 'string') throw new Error();
    checkId(body.id); checkPostcode(body.postcode);
    return { id: body.id, postcode: body.postcode };
  });
}
function clientResponse(body: unknown): UkrposhtaRemoteClient {
  return validatedResponse(() => {
    if (!isRecord(body) || typeof body.uuid !== 'string' || typeof body.externalId !== 'string' || typeof body.addressId !== 'number') throw new Error();
    checkUuid(body.uuid); checkExternalId(body.externalId); checkId(body.addressId);
    return { uuid: body.uuid, externalId: body.externalId, addressId: body.addressId };
  });
}
function lifecycleResponse(body: unknown): UkrposhtaLifecycle {
  if (!isRecord(body) || !['CREATED', 'REGISTERED', 'DELIVERED', 'IN_DEPARTMENT', 'DELIVERING', 'FORWARDING', 'RETURNING', 'RETURNED', 'STORAGE', 'CANCELED', 'DELETED'].includes(String(body.status)) ||
    typeof body.statusDate !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?$/.test(body.statusDate) || !Number.isFinite(Date.parse(body.statusDate))) throw new UkrposhtaError('INVALID_RESPONSE', null);
  return { status: body.status as UkrposhtaLifecycle['status'], statusDate: body.statusDate };
}
function shipmentResponse(body: unknown): UkrposhtaShipment {
  return validatedResponse(() => {
    if (!isRecord(body) || typeof body.uuid !== 'string' || typeof body.barcode !== 'string' || !Array.isArray(body.parcels) || body.parcels.length < 1 || body.parcels.length > 100) throw new Error();
    checkUuid(body.uuid); checkBarcode(body.barcode);
    const parcels = body.parcels.map((parcel: unknown) => {
      if (!isRecord(parcel) || typeof parcel.uuid !== 'string' || typeof parcel.barcode !== 'string') throw new Error();
      checkUuid(parcel.uuid); checkBarcode(parcel.barcode);
      return { uuid: parcel.uuid, barcode: parcel.barcode };
    });
    return { uuid: body.uuid, barcode: body.barcode, deliveryPrice: responseMoney(body.deliveryPrice), parcels, lifecycle: lifecycleResponse(body.lifecycle) };
  });
}
function transportError(error: unknown): UkrposhtaError {
  const name = error instanceof Error ? error.name : '';
  return new UkrposhtaError(name === 'AbortError' || name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK', null);
}
async function boundedBody(response: Response, limit: number): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length'));
  if (!Number.isFinite(length) || length < 0 || length > limit) throw new UkrposhtaError('INVALID_RESPONSE', response.status);
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new UkrposhtaError('INVALID_RESPONSE', response.status); }
      chunks.push(chunk.value);
    }
  } catch (error) { if (error instanceof UkrposhtaError) throw error; throw transportError(error); }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export type NovaPoshtaErrorCode =
  | 'UNAUTHORIZED'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'INVALID_RESPONSE'
  | 'PROVIDER_ERROR';

export interface NovaPoshtaClientConfig {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface NovaPoshtaSenderProfile {
  ref: string;
  label: string;
  edrpou: string | null;
}

export interface NovaPoshtaCity {
  ref: string;
  label: string;
  areaLabel: string | null;
}

export interface NovaPoshtaLocation {
  ref: string;
  cityRef: string;
  label: string;
  number: string;
  type: 'BRANCH' | 'PARCEL_LOCKER';
}

export interface NovaPoshtaLocationSearchInput {
  cityRef: string;
  query?: string;
  type?: 'BRANCH' | 'PARCEL_LOCKER';
}

export interface NovaPoshtaShipmentInput {
  sender: {
    cityRef: string;
    locationRef: string;
    counterpartyRef: string;
    contactRef: string;
    phone: string;
  };
  recipient: {
    name: string;
    phone: string;
    cityRef: string;
    cityLabel: string;
    locationRef: string;
    locationNumber: string;
  };
  parcel: {
    weightKg: number;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
  };
  payer: 'SENDER' | 'RECIPIENT';
  declaredValue: number;
  codAmount: number | null;
  description: string;
  clientRef: string;
}

export interface NovaPoshtaQuote {
  currency: 'UAH';
  cost: number;
  estimatedDeliveryDate: string | null;
}

export interface NovaPoshtaShipmentReference {
  documentRef: string;
  trackingNumber: string;
  clientRef: string;
}

export interface NovaPoshtaCreatedShipment {
  documentRef: string;
  trackingNumber: string;
  cost: number | null;
}

export interface NovaPoshtaShipmentStatus {
  trackingNumber: string;
  providerCode: string;
  providerLabel: string;
}

export class NovaPoshtaError extends Error {
  constructor(readonly code: NovaPoshtaErrorCode, readonly status: number | null) {
    super(`Nova Poshta API request failed (${code})`);
    this.name = 'NovaPoshtaError';
  }
}

export class NovaPoshtaClient {
  private readonly endpoint = 'https://api.novaposhta.ua/v2.0/json/';
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: NovaPoshtaClientConfig) {
    if (config.apiKey.trim().length < 8 || config.apiKey.length > 512) {
      throw new Error('Invalid Nova Poshta API key');
    }
    this.fetchFn = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  async validateCredential(): Promise<{ valid: true }> {
    await this.request('Counterparty', 'getCounterparties', {
      CounterpartyProperty: 'Sender',
      Page: '1',
      Limit: '1',
    });
    return { valid: true };
  }

  async listSenderProfiles(): Promise<NovaPoshtaSenderProfile[]> {
    const rows = await this.request('Counterparty', 'getCounterparties', {
      CounterpartyProperty: 'Sender',
      Page: '1',
      Limit: '100',
    });
    return rows.map((row) => ({
      ref: requiredString(row.Ref),
      label: requiredString(row.Description),
      edrpou: optionalString(row.EDRPOU),
    }));
  }

  async searchCities(query: string): Promise<NovaPoshtaCity[]> {
    const normalized = boundedText(query, 2, 120);
    const rows = await this.request('Address', 'getCities', {
      FindByString: normalized,
      Limit: '20',
      Page: '1',
    });
    return rows.map((row) => ({
      ref: requiredString(row.Ref),
      label: requiredString(row.Description),
      areaLabel: optionalString(row.AreaDescription),
    }));
  }

  async searchLocations(input: NovaPoshtaLocationSearchInput): Promise<NovaPoshtaLocation[]> {
    const cityRef = providerRef(input.cityRef);
    const query = input.query?.trim() ?? '';
    if (query.length > 120) throw new Error('Invalid Nova Poshta location query');
    const rows = await this.request('Address', 'getWarehouses', {
      CityRef: cityRef,
      FindByString: query,
      Limit: '50',
      Page: '1',
    });
    const locations = rows.map((row) => ({
      ref: requiredString(row.Ref),
      cityRef: requiredString(row.CityRef),
      label: requiredString(row.Description),
      number: requiredString(row.Number),
      type: warehouseType(row),
    }));
    return input.type ? locations.filter((location) => location.type === input.type) : locations;
  }

  async calculateShipment(input: NovaPoshtaShipmentInput): Promise<NovaPoshtaQuote> {
    const normalized = validateShipmentInput(input);
    const rows = await this.request('InternetDocument', 'getDocumentPrice', quoteProperties(normalized));
    const row = firstRow(rows);
    return {
      currency: 'UAH',
      cost: money(row.Cost),
      estimatedDeliveryDate: optionalProviderDate(row.EstimatedDeliveryDate),
    };
  }

  async findShipmentByClientRef(clientRef: string): Promise<NovaPoshtaShipmentReference | null> {
    const normalized = boundedText(clientRef, 1, 100);
    const rows = await this.request('InternetDocument', 'getDocumentList', {
      InfoRegClientBarcodes: normalized,
      GetFullList: '1',
      Page: '1',
    });
    const match = rows.find((row) => row.InfoRegClientBarcodes === normalized);
    if (!match) return null;
    return {
      documentRef: requiredString(match.Ref),
      trackingNumber: trackingNumber(match.IntDocNumber),
      clientRef: requiredString(match.InfoRegClientBarcodes),
    };
  }

  async createShipment(input: NovaPoshtaShipmentInput): Promise<NovaPoshtaCreatedShipment> {
    const normalized = validateShipmentInput(input);
    const properties: Record<string, unknown> = {
      ...quoteProperties(normalized),
      Sender: normalized.sender.counterpartyRef,
      SenderAddress: normalized.sender.locationRef,
      ContactSender: normalized.sender.contactRef,
      SendersPhone: wirePhone(normalized.sender.phone),
      RecipientType: 'PrivatePerson',
      RecipientName: normalized.recipient.name,
      RecipientContactName: normalized.recipient.name,
      RecipientsPhone: wirePhone(normalized.recipient.phone),
      RecipientWarehouseRef: normalized.recipient.locationRef,
      RecipientCityName: normalized.recipient.cityLabel,
      RecipientAddressName: normalized.recipient.locationNumber,
      NewAddress: '1',
      PaymentMethod: 'Cash',
      CargoType: 'Parcel',
      SeatsAmount: '1',
      Description: normalized.description,
      InfoRegClientBarcodes: normalized.clientRef,
      OptionsSeat: [{
        volumetricVolume: volumeM3(normalized.parcel),
        volumetricWidth: normalized.parcel.widthCm,
        volumetricLength: normalized.parcel.lengthCm,
        volumetricHeight: normalized.parcel.heightCm,
        weight: normalized.parcel.weightKg,
      }],
    };
    if (normalized.codAmount !== null && normalized.codAmount > 0) {
      properties.AfterpaymentOnGoodsCost = normalized.codAmount;
    }
    const row = firstRow(await this.request('InternetDocument', 'save', properties));
    return {
      documentRef: requiredString(row.Ref),
      trackingNumber: trackingNumber(row.IntDocNumber),
      cost: optionalMoney(row.CostOnSite ?? row.Cost),
    };
  }

  async getShipmentStatus(tracking: string): Promise<NovaPoshtaShipmentStatus> {
    const normalized = trackingNumber(tracking);
    const row = firstRow(await this.request('TrackingDocument', 'getStatusDocuments', {
      Documents: [{ DocumentNumber: normalized, Phone: '' }],
    }));
    return {
      trackingNumber: trackingNumber(row.Number ?? row.IntDocNumber),
      providerCode: requiredString(row.StatusCode),
      providerLabel: requiredString(row.Status),
    };
  }

  async getLabel(documentRef: string): Promise<Uint8Array> {
    const row = firstRow(await this.request('InternetDocument', 'printDocument', {
      DocumentRefs: [providerRef(documentRef)],
      Type: 'pdf',
    }));
    const content = requiredString(row.Content);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(content) || content.length % 4 !== 0) {
      throw new NovaPoshtaError('INVALID_RESPONSE', 200);
    }
    const bytes = Uint8Array.from(Buffer.from(content, 'base64'));
    if (bytes.length < 4 || String.fromCharCode(...bytes.slice(0, 4)) !== '%PDF') {
      throw new NovaPoshtaError('INVALID_RESPONSE', 200);
    }
    return bytes;
  }

  async cancelShipment(documentRef: string): Promise<{ cancelled: true }> {
    const ref = providerRef(documentRef);
    const row = firstRow(await this.request('InternetDocument', 'delete', { DocumentRefs: [ref] }));
    if (row.Ref !== ref) throw new NovaPoshtaError('INVALID_RESPONSE', 200);
    return { cancelled: true };
  }

  private async request(
    modelName: string,
    calledMethod: string,
    methodProperties: Record<string, unknown>,
  ): Promise<Array<Record<string, unknown>>> {
    let response: Response;
    try {
      response = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: this.config.apiKey, modelName, calledMethod, methodProperties }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const name = isRecord(error) && typeof error.name === 'string' ? error.name : '';
      throw new NovaPoshtaError(name === 'AbortError' || name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK', null);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new NovaPoshtaError('INVALID_RESPONSE', response.status);
    }
    if (!isRecord(payload) || typeof payload.success !== 'boolean' || !Array.isArray(payload.data)) {
      throw new NovaPoshtaError('INVALID_RESPONSE', response.status);
    }
    if (!response.ok || payload.success === false) throw providerError(response.status, payload);
    if (!payload.data.every(isRecord)) throw new NovaPoshtaError('INVALID_RESPONSE', response.status);
    return payload.data;
  }
}

function providerError(status: number, payload: Record<string, unknown>): NovaPoshtaError {
  if (status === 401 || status === 403) return new NovaPoshtaError('UNAUTHORIZED', status);
  if (status === 429) return new NovaPoshtaError('RATE_LIMITED', status);
  const errors = Array.isArray(payload.errors)
    ? payload.errors.filter((value): value is string => typeof value === 'string').join(' ').toLowerCase()
    : '';
  if (status === 400 || /valid|required|incorrect|empty|not found|невір|помил/.test(errors)) {
    return new NovaPoshtaError('VALIDATION', status);
  }
  return new NovaPoshtaError('PROVIDER_ERROR', status);
}

function validateShipmentInput(input: NovaPoshtaShipmentInput): NovaPoshtaShipmentInput {
  providerRef(input.sender.cityRef);
  providerRef(input.sender.locationRef);
  providerRef(input.sender.counterpartyRef);
  providerRef(input.sender.contactRef);
  providerRef(input.recipient.cityRef);
  providerRef(input.recipient.locationRef);
  boundedText(input.recipient.name, 2, 120);
  boundedText(input.recipient.cityLabel, 1, 120);
  boundedText(input.recipient.locationNumber, 1, 32);
  boundedText(input.description, 1, 100);
  boundedText(input.clientRef, 1, 100);
  wirePhone(input.sender.phone);
  wirePhone(input.recipient.phone);
  positive(input.parcel.weightKg, 1_000);
  positive(input.parcel.lengthCm, 300);
  positive(input.parcel.widthCm, 300);
  positive(input.parcel.heightCm, 300);
  positive(input.declaredValue, 10_000_000);
  if (input.codAmount !== null && (!Number.isFinite(input.codAmount) || input.codAmount < 0 || input.codAmount > input.declaredValue)) {
    throw new Error('Invalid Nova Poshta COD amount');
  }
  return input;
}

function quoteProperties(input: NovaPoshtaShipmentInput): Record<string, unknown> {
  return {
    CitySender: input.sender.cityRef,
    CityRecipient: input.recipient.cityRef,
    ServiceType: 'WarehouseWarehouse',
    Weight: input.parcel.weightKg,
    Cost: input.declaredValue,
    CargoType: 'Parcel',
    SeatsAmount: '1',
    PayerType: input.payer === 'SENDER' ? 'Sender' : 'Recipient',
  };
}

function warehouseType(row: Record<string, unknown>): 'BRANCH' | 'PARCEL_LOCKER' {
  const category = `${optionalString(row.CategoryOfWarehouse) ?? ''} ${optionalString(row.Description) ?? ''}`.toLowerCase();
  return /postomat|поштомат|parcel locker/.test(category) ? 'PARCEL_LOCKER' : 'BRANCH';
}

function firstRow(rows: Array<Record<string, unknown>>): Record<string, unknown> {
  if (rows.length === 0) throw new NovaPoshtaError('INVALID_RESPONSE', 200);
  return rows[0]!;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 1_000) {
    throw new NovaPoshtaError('INVALID_RESPONSE', 200);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 1_000 ? value.trim() : null;
}

function providerRef(value: string): string {
  return boundedText(value, 1, 128);
}

function boundedText(value: string, min: number, max: number): string {
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) throw new Error('Invalid Nova Poshta input');
  return normalized;
}

function trackingNumber(value: unknown): string {
  const normalized = requiredString(value);
  if (!/^\d{8,20}$/.test(normalized)) throw new NovaPoshtaError('INVALID_RESPONSE', 200);
  return normalized;
}

function money(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.')) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10_000_000) {
    throw new NovaPoshtaError('INVALID_RESPONSE', 200);
  }
  return parsed;
}

function optionalMoney(value: unknown): number | null {
  return value === undefined || value === null || value === '' ? null : money(value);
}

function optionalProviderDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const raw = requiredString(value);
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw);
  if (!match) throw new NovaPoshtaError('INVALID_RESPONSE', 200);
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function wirePhone(value: string): string {
  if (!/^\+380\d{9}$/.test(value)) throw new Error('Invalid Nova Poshta phone');
  return value.slice(1);
}

function positive(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > max) throw new Error('Invalid Nova Poshta numeric input');
  return value;
}

function volumeM3(parcel: NovaPoshtaShipmentInput['parcel']): number {
  return Number(((parcel.lengthCm * parcel.widthCm * parcel.heightCm) / 1_000_000).toFixed(6));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

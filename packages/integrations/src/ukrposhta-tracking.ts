export type UkrposhtaTrackingErrorCode =
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'INVALID_RESPONSE'
  | 'PROVIDER_ERROR';

export interface UkrposhtaTrackingClientConfig {
  trackingBearer: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface UkrposhtaTrackingEvent {
  barcode: string;
  providerCode: string;
  providerReasonCode: string | null;
  occurredAt: Date;
  raw: Record<string, unknown>;
}

export interface UkrposhtaTrackingBatchResult {
  found: UkrposhtaTrackingEvent[];
  notFound: string[];
}

export class UkrposhtaTrackingError extends Error {
  constructor(readonly code: UkrposhtaTrackingErrorCode, readonly status: number | null) {
    super(`Ukrposhta tracking request failed (${code})`);
    this.name = 'UkrposhtaTrackingError';
  }
}

const trackingUrl = 'https://www.ukrposhta.ua/status-tracking/0.0.1/statuses/with-not-found';
const maxBatch = 50;
const maxJsonBytes = 1024 * 1024;
const barcodePattern = /^(?:\d{13}|[A-Z]{2}\d{9}[A-Z]{2})$/;

export class UkrposhtaStatusTrackingClient {
  private readonly bearer: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: UkrposhtaTrackingClientConfig) {
    this.bearer = credential(config.trackingBearer);
    this.fetchFn = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async getLastStatuses(barcodes: string[]): Promise<UkrposhtaTrackingBatchResult> {
    validateBatch(barcodes);
    let lastError: UkrposhtaTrackingError | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await this.sleep(200 * 2 ** (attempt - 1));
      try {
        const response = await this.fetchFn(trackingUrl, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
          headers: { authorization: `Bearer ${this.bearer}`, accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify(barcodes),
        });
        if (!response.ok) throw httpError(response.status);
        if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
          throw new UkrposhtaTrackingError('INVALID_RESPONSE', response.status);
        }
        return parseResponse(await boundedJson(response), barcodes);
      } catch (error) {
        const safe = error instanceof UkrposhtaTrackingError ? error : transportError(error);
        lastError = safe;
        if (attempt === 2 || !['RATE_LIMITED', 'TIMEOUT', 'NETWORK', 'PROVIDER_ERROR'].includes(safe.code)) throw safe;
      }
    }
    throw lastError ?? new UkrposhtaTrackingError('PROVIDER_ERROR', null);
  }
}

function validateBatch(barcodes: string[]): void {
  if (!Array.isArray(barcodes) || barcodes.length < 1 || barcodes.length > maxBatch || new Set(barcodes).size !== barcodes.length || barcodes.some((barcode) => !barcodePattern.test(barcode))) {
    throw new UkrposhtaTrackingError('VALIDATION', null);
  }
}

function parseResponse(value: unknown, requested: string[]): UkrposhtaTrackingBatchResult {
  if (!isRecord(value) || !isRecord(value.found) || !Array.isArray(value.notFound) || value.notFound.some((barcode) => typeof barcode !== 'string')) {
    throw new UkrposhtaTrackingError('INVALID_RESPONSE', null);
  }
  const expected = new Set(requested);
  const notFound = value.notFound as string[];
  const seenBarcodes = new Set<string>();
  const found: UkrposhtaTrackingEvent[] = [];
  for (const [key, entries] of Object.entries(value.found)) {
    if (!expected.has(key) || !Array.isArray(entries) || entries.length < 1 || entries.length > 10_000 || seenBarcodes.has(key)) {
      throw new UkrposhtaTrackingError('INVALID_RESPONSE', null);
    }
    seenBarcodes.add(key);
    for (const entry of entries) {
      const parsed = parseEvent(entry);
      if (parsed.barcode !== key) throw new UkrposhtaTrackingError('INVALID_RESPONSE', null);
      found.push(parsed);
    }
  }
  for (const barcode of notFound) {
    if (!expected.has(barcode) || seenBarcodes.has(barcode)) throw new UkrposhtaTrackingError('INVALID_RESPONSE', null);
    seenBarcodes.add(barcode);
  }
  if (seenBarcodes.size !== expected.size) throw new UkrposhtaTrackingError('INVALID_RESPONSE', null);
  return { found, notFound };
}

function parseEvent(value: unknown): UkrposhtaTrackingEvent {
  if (!isRecord(value) || !barcodePattern.test(String(value.barcode)) || !Number.isSafeInteger(value.step) || Number(value.step) < 0 ||
    typeof value.date !== 'string' || !validProviderDate(value.date) ||
    !numericCode(value.event) || !nullableNumericCode(value.eventReason_id) || JSON.stringify(value).length > 16_384) {
    throw new UkrposhtaTrackingError('INVALID_RESPONSE', null);
  }
  for (const field of ['index', 'name', 'eventName', 'country', 'eventReason']) {
    const fieldValue = value[field];
    if (fieldValue !== null && fieldValue !== undefined && (typeof fieldValue !== 'string' || fieldValue.length > 2_000)) {
      throw new UkrposhtaTrackingError('INVALID_RESPONSE', null);
    }
  }
  return {
    barcode: String(value.barcode), providerCode: String(value.event),
    providerReasonCode: value.eventReason_id === null || value.eventReason_id === undefined ? null : String(value.eventReason_id),
    occurredAt: kyivLocalDate(value.date), raw: sanitizeSnapshot(value),
  };
}

function sanitizeSnapshot(value: Record<string, unknown>): Record<string, unknown> {
  return sanitizeRecord(value, 0);
}

function sanitizeRecord(value: Record<string, unknown>, depth: number): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/(?:authorization|bearer|token|secret|credential|password)/i.test(key)) continue;
    if (depth >= 8) continue;
    if (Array.isArray(entry)) safe[key] = entry.slice(0, 100).map((item) => isRecord(item) ? sanitizeRecord(item, depth + 1) : item);
    else if (isRecord(entry)) safe[key] = sanitizeRecord(entry, depth + 1);
    else safe[key] = entry;
  }
  return safe;
}

function validProviderDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?$/.test(value) && Number.isFinite(Date.parse(`${value}Z`));
}
function kyivLocalDate(value: string): Date {
  const [datePart, timePart] = value.split('T');
  const [year, month, day] = datePart!.split('-').map(Number);
  const [hour, minute, secondPart] = timePart!.split(':');
  const second = Math.floor(Number(secondPart));
  const millisecond = Math.floor((Number(secondPart) - second) * 1_000);
  const localAsUtc = Date.UTC(year!, month! - 1, day!, Number(hour), Number(minute), second, millisecond);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(localAsUtc));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  const zoneAsUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return new Date(localAsUtc - (zoneAsUtc - localAsUtc));
}
function numericCode(value: unknown): boolean { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 || typeof value === 'string' && /^\d{1,12}$/.test(value); }
function nullableNumericCode(value: unknown): boolean { return value === null || value === undefined || numericCode(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function credential(value: string): string { const result = value.trim(); if (result.length < 8 || result.length > 2_048) throw new Error('Invalid Ukrposhta tracking credential'); return result; }

function httpError(status: number): UkrposhtaTrackingError {
  if (status === 401 || status === 403) return new UkrposhtaTrackingError('UNAUTHORIZED', status);
  if (status === 404) return new UkrposhtaTrackingError('NOT_FOUND', status);
  if (status === 429) return new UkrposhtaTrackingError('RATE_LIMITED', status);
  return new UkrposhtaTrackingError(status >= 500 ? 'PROVIDER_ERROR' : 'VALIDATION', status);
}
function transportError(error: unknown): UkrposhtaTrackingError {
  const name = error instanceof Error ? error.name : '';
  return new UkrposhtaTrackingError(name === 'AbortError' || name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK', null);
}
async function boundedJson(response: Response): Promise<unknown> {
  const lengthHeader = response.headers.get('content-length');
  if (lengthHeader !== null) {
    const length = Number(lengthHeader);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxJsonBytes) throw new UkrposhtaTrackingError('INVALID_RESPONSE', response.status);
  }
  if (!response.body) throw new UkrposhtaTrackingError('INVALID_RESPONSE', response.status);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxJsonBytes) { await reader.cancel(); throw new UkrposhtaTrackingError('INVALID_RESPONSE', response.status); }
      chunks.push(chunk.value);
    }
  } catch (error) { if (error instanceof UkrposhtaTrackingError) throw error; throw transportError(error); }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
  catch { throw new UkrposhtaTrackingError('INVALID_RESPONSE', response.status); }
}

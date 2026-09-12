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
}

export class UkrposhtaError extends Error {
  constructor(readonly code: UkrposhtaErrorCode, readonly status: number | null) {
    super(`Ukrposhta API request failed (${code})`);
    this.name = 'UkrposhtaError';
  }
}

export class UkrposhtaClient {
  private readonly config: Omit<UkrposhtaClientConfig, 'fetch' | 'timeoutMs'>;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

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

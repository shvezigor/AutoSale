import { createHmac, timingSafeEqual } from 'node:crypto';

const INVALID_REQUEST = 'Invalid Meta signed request';

export class MetaSignedRequest {
  constructor(private readonly appSecret: string) {}

  parseUserId(value: string): string {
    const [encodedSignature, encodedPayload, extra] = value.split('.');
    if (!encodedSignature || !encodedPayload || extra !== undefined) throw invalidRequest();

    const supplied = decodeBase64Url(encodedSignature);
    const expected = createHmac('sha256', this.appSecret).update(encodedPayload).digest();
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw invalidRequest();
    }

    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    } catch {
      throw invalidRequest();
    }
    if (!isPayload(payload)) throw invalidRequest();
    return payload.user_id;
  }
}

function decodeBase64Url(value: string): Buffer {
  try {
    return Buffer.from(value, 'base64url');
  } catch {
    throw invalidRequest();
  }
}

function isPayload(value: unknown): value is { algorithm: 'HMAC-SHA256'; user_id: string } {
  return typeof value === 'object' && value !== null &&
    'algorithm' in value && value.algorithm === 'HMAC-SHA256' &&
    'user_id' in value && typeof value.user_id === 'string' && value.user_id.length > 0;
}

function invalidRequest(): Error {
  return new Error(INVALID_REQUEST);
}

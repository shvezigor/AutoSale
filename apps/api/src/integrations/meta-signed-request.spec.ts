import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { MetaSignedRequest } from './meta-signed-request.js';

const secret = 'meta-app-secret-value';

function encode(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function sign(payload: Record<string, unknown>): string {
  const encodedPayload = encode(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${signature}.${encodedPayload}`;
}

describe('MetaSignedRequest', () => {
  it('returns the provider user id from a valid HMAC-SHA256 request', () => {
    const parser = new MetaSignedRequest(secret);

    expect(parser.parseUserId(sign({ algorithm: 'HMAC-SHA256', user_id: '17841400000000000' })))
      .toBe('17841400000000000');
  });

  it('rejects a request whose payload was changed after signing', () => {
    const parser = new MetaSignedRequest(secret);
    const valid = sign({ algorithm: 'HMAC-SHA256', user_id: 'account-a' });
    const [signature] = valid.split('.');

    expect(() => parser.parseUserId(`${signature}.${encode(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: 'account-b' }))}`))
      .toThrow('Invalid Meta signed request');
  });

  it.each([
    '',
    'missing-separator',
    sign({ algorithm: 'none', user_id: 'account-a' }),
    sign({ algorithm: 'HMAC-SHA256' }),
  ])('rejects malformed or incomplete provider input', (value) => {
    expect(() => new MetaSignedRequest(secret).parseUserId(value)).toThrow('Invalid Meta signed request');
  });
});

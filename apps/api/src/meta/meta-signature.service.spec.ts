import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { MetaSignatureService } from './meta-signature.service.js';

const secret = 'meta-app-secret-value';

describe('MetaSignatureService', () => {
  const service = new MetaSignatureService(secret);

  it('accepts the matching sha256 signature', () => {
    const body = Buffer.from('{"object":"instagram"}');
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

    expect(service.verify(body, signature)).toBe(true);
  });

  it.each([
    '',
    'sha1=00',
    'sha256=00',
    'sha256=not-hex',
  ])('rejects a malformed or mismatched signature: %s', (signature) => {
    expect(service.verify(Buffer.from('{}'), signature)).toBe(false);
  });
});

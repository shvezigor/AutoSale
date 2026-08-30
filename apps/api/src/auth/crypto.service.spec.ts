import { describe, expect, it } from 'vitest';

import { CryptoService } from './crypto.service.js';

describe('CryptoService', () => {
  const service = new CryptoService();

  it('hashes and verifies passwords without retaining plaintext', async () => {
    const hash = await service.hashPassword('long-secure-password');
    expect(hash).not.toContain('long-secure-password');
    expect(await service.verifyPassword(hash, 'long-secure-password')).toBe(true);
    expect(await service.verifyPassword(hash, 'wrong-password')).toBe(false);
  });

  it('issues opaque tokens with deterministic peppered hashes', () => {
    const issued = service.issueOpaqueToken('p'.repeat(32));
    expect(issued.raw).not.toBe(issued.hash);
    expect(service.hashOpaqueToken(issued.raw, 'p'.repeat(32))).toBe(issued.hash);
  });
});

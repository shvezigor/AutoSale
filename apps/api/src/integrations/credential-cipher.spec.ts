import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { CredentialCipher } from './credential-cipher.js';

describe('CredentialCipher', () => {
  it('round-trips a credential', () => {
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));

    expect(cipher.decrypt(cipher.encrypt('secret-token'))).toBe('secret-token');
  });

  it('generates a distinct payload for each encryption', () => {
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));

    expect(cipher.encrypt('secret-token')).not.toBe(cipher.encrypt('secret-token'));
  });

  it('rejects a tampered payload without exposing its contents', () => {
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const payload = cipher.encrypt('secret-token');
    const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith('A') ? 'B' : 'A'}`;

    expect(() => cipher.decrypt(tamperedPayload)).toThrow('Invalid encrypted credential');
  });

  it('rejects an unsupported payload version', () => {
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));

    expect(() => cipher.decrypt('v2.any.any.any')).toThrow('Invalid encrypted credential');
  });

  it('requires an AES-256 key', () => {
    expect(() => new CredentialCipher(Buffer.alloc(31, 7))).toThrow('Credential encryption key must be exactly 32 bytes');
  });
});

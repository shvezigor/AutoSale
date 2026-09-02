import { describe, expect, it } from 'vitest';

import { CredentialCipher } from './credential-cipher.js';

describe('CredentialCipher', () => {
  it('decrypts a credential encrypted with the shared format', () => {
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    expect(cipher.decrypt(cipher.encrypt('profile-access-token'))).toBe('profile-access-token');
  });

  it('rejects a tampered credential without exposing its contents', () => {
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const encrypted = cipher.encrypt('profile-access-token');
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith('A') ? 'B' : 'A'}`;

    expect(() => cipher.decrypt(tampered)).toThrow('Invalid encrypted credential');
  });
});

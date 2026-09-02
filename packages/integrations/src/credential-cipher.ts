import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PAYLOAD_VERSION = 'v1';
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]*$/;

function decodeBase64Url(value: string): Buffer {
  if (!BASE64_URL_PATTERN.test(value)) throw new Error('Invalid base64url');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new Error('Non-canonical base64url');
  return decoded;
}

export class CredentialCipher {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('Credential encryption key must be exactly 32 bytes');
    this.key = Buffer.from(key);
  }

  encrypt(plaintext: string): string {
    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
      PAYLOAD_VERSION,
      nonce.toString('base64url'),
      ciphertext.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string): string {
    try {
      const parts = payload.split('.');
      if (parts.length !== 4 || parts[0] !== PAYLOAD_VERSION) throw new Error('Invalid payload format');
      const nonce = decodeBase64Url(parts[1] ?? '');
      const ciphertext = decodeBase64Url(parts[2] ?? '');
      const tag = decodeBase64Url(parts[3] ?? '');
      if (nonce.length !== NONCE_LENGTH || tag.length !== AUTH_TAG_LENGTH) throw new Error('Invalid payload lengths');
      const decipher = createDecipheriv(ALGORITHM, this.key, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Invalid encrypted credential');
    }
  }
}

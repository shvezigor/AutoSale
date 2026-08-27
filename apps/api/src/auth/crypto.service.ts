import { createHmac, randomBytes } from 'node:crypto';

import { argon2id, hash, verify } from 'argon2';

export class CryptoService {
  hashPassword(password: string): Promise<string> {
    return hash(password, {
      type: argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  verifyPassword(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, password);
  }

  issueOpaqueToken(pepper: string): { raw: string; hash: string } {
    const raw = randomBytes(32).toString('base64url');
    return { raw, hash: this.hashOpaqueToken(raw, pepper) };
  }

  hashOpaqueToken(raw: string, pepper: string): string {
    return createHmac('sha256', pepper).update(raw).digest('hex');
  }
}

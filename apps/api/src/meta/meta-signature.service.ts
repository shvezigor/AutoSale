import { createHmac, timingSafeEqual } from 'node:crypto';

export class MetaSignatureService {
  private readonly appSecrets: readonly string[];

  constructor(appSecrets: string | readonly string[]) {
    this.appSecrets = [...new Set(typeof appSecrets === 'string' ? [appSecrets] : appSecrets)];

    if (this.appSecrets.length === 0) {
      throw new Error('At least one Meta app secret is required');
    }
  }

  verify(rawBody: Buffer, header: string): boolean {
    if (!header.startsWith('sha256=')) {
      return false;
    }

    const suppliedHex = header.slice('sha256='.length);
    if (!/^[a-f\d]{64}$/i.test(suppliedHex)) {
      return false;
    }

    const supplied = Buffer.from(suppliedHex, 'hex');

    return this.appSecrets.reduce((matched, appSecret) => {
      const expected = createHmac('sha256', appSecret).update(rawBody).digest();
      return (supplied.length === expected.length && timingSafeEqual(supplied, expected)) || matched;
    }, false);
  }
}

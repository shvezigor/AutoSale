import { createHmac, timingSafeEqual } from 'node:crypto';

export class MetaSignatureService {
  constructor(private readonly appSecret: string) {}

  verify(rawBody: Buffer, header: string): boolean {
    if (!header.startsWith('sha256=')) {
      return false;
    }

    const suppliedHex = header.slice('sha256='.length);
    if (!/^[a-f\d]{64}$/i.test(suppliedHex)) {
      return false;
    }

    const expected = createHmac('sha256', this.appSecret).update(rawBody).digest();
    const supplied = Buffer.from(suppliedHex, 'hex');

    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
}

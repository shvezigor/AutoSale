import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export class CsrfService {
  constructor(private readonly pepper: string) {}

  issue(sessionId: string): string {
    const nonce = randomBytes(24).toString('base64url');
    return `${nonce}.${this.mac(sessionId, nonce)}`;
  }

  verify(sessionId: string, token: string): boolean {
    const [nonce, supplied, extra] = token.split('.');
    if (!nonce || !supplied || extra !== undefined) return false;
    const expected = this.mac(sessionId, nonce);
    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);
    return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
  }

  private mac(sessionId: string, nonce: string): string {
    return createHmac('sha256', this.pepper).update(`${sessionId}:${nonce}`).digest('base64url');
  }
}

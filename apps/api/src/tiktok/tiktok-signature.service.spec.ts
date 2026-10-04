import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { TikTokSignatureService } from './tiktok-signature.service.js';

const secret = 'fictional-tiktok-app-secret';
const rawBody = Buffer.from('{"event":"im_receive_msg","user_openid":"fictional-account"}');
const nowSeconds = 1_780_000_000;

function header(timestamp: number, body = rawBody): string {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body.toString('utf8')}`).digest('hex');
  return `t=${timestamp},s=${signature}`;
}

describe('TikTokSignatureService', () => {
  const service = new TikTokSignatureService(secret, () => nowSeconds, 300);

  it('verifies the exact raw body and a fresh provider timestamp', () => {
    expect(service.verify(rawBody, header(nowSeconds - 5))).toBe(true);
  });

  it('rejects changed bodies, malformed headers, and stale or future deliveries', () => {
    expect(service.verify(Buffer.from('{}'), header(nowSeconds - 5))).toBe(false);
    expect(service.verify(rawBody, 't=not-a-time,s=bad')).toBe(false);
    expect(service.verify(rawBody, header(nowSeconds - 301))).toBe(false);
    expect(service.verify(rawBody, header(nowSeconds + 301))).toBe(false);
  });

  it('accepts any valid signature when providers rotate signatures in one header', () => {
    expect(service.verify(rawBody, `t=${nowSeconds},s=${'0'.repeat(64)},${header(nowSeconds).split(',')[1]}`)).toBe(true);
  });
});

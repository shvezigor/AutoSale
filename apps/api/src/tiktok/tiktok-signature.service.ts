import { createHmac, timingSafeEqual } from 'node:crypto';

const HEX_SHA256 = /^[a-f0-9]{64}$/i;

export class TikTokSignatureService {
  constructor(
    private readonly appSecret: string,
    private readonly nowSeconds: () => number = () => Math.floor(Date.now() / 1_000),
    private readonly maximumAgeSeconds = 300,
  ) {}

  verify(rawBody: Buffer, header: string): boolean {
    const parsed = parseHeader(header);
    if (!parsed) return false;
    if (Math.abs(this.nowSeconds() - parsed.timestamp) > this.maximumAgeSeconds) return false;

    const expected = createHmac('sha256', this.appSecret)
      .update(`${parsed.timestamp}.${rawBody.toString('utf8')}`)
      .digest();
    return parsed.signatures.some((signature) => {
      if (!HEX_SHA256.test(signature)) return false;
      const received = Buffer.from(signature, 'hex');
      return received.length === expected.length && timingSafeEqual(received, expected);
    });
  }
}

function parseHeader(header: string): { timestamp: number; signatures: string[] } | null {
  const values = header.split(',').map((part) => part.trim()).filter(Boolean);
  const timestamps: string[] = [];
  const signatures: string[] = [];
  for (const value of values) {
    const separator = value.indexOf('=');
    if (separator <= 0) return null;
    const key = value.slice(0, separator);
    const item = value.slice(separator + 1);
    if (key === 't') timestamps.push(item);
    if (key === 's') signatures.push(item);
  }
  if (timestamps.length !== 1 || signatures.length === 0 || !/^\d{1,12}$/.test(timestamps[0]!)) return null;
  const timestamp = Number(timestamps[0]);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  return { timestamp, signatures };
}

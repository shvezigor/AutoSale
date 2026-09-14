import { describe, expect, it, vi } from 'vitest';

import { UkrposhtaStatusTrackingClient } from './ukrposhta-tracking.js';

const event = {
  barcode: '0500100031143', step: 16, date: '2026-03-04T10:20:30', index: '01001',
  name: 'КИЇВ 1', event: 41000, eventName: 'Відправлення вручено', country: 'Україна',
  eventReason: 'особисто', eventReason_id: 2, mailType: 4096, indexOrder: 4,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('Ukrposhta StatusTracking boundary', () => {
  it('reads a batch from the fixed official host with only the tracking bearer', async () => {
    const accepted = { ...event, step: 3, date: '2026-03-04T09:20:30', event: 10100, eventName: 'Відправлення прийнято' };
    const fetchFn = vi.fn().mockResolvedValue(json({ found: { [event.barcode]: [accepted, event] }, notFound: ['0500100031135'] }));
    const client = new UkrposhtaStatusTrackingClient({ trackingBearer: 'tracking-secret', fetch: fetchFn });

    await expect(client.getLastStatuses([event.barcode, '0500100031135'])).resolves.toEqual({
      found: [
        { barcode: event.barcode, providerCode: '10100', providerReasonCode: '2', occurredAt: new Date('2026-03-04T07:20:30.000Z'), raw: accepted },
        { barcode: event.barcode, providerCode: '41000', providerReasonCode: '2', occurredAt: new Date('2026-03-04T08:20:30.000Z'), raw: event },
      ],
      notFound: ['0500100031135'],
    });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://www.ukrposhta.ua/status-tracking/0.0.1/statuses/with-not-found');
    expect(init).toEqual(expect.objectContaining({ method: 'POST', redirect: 'error', body: JSON.stringify([event.barcode, '0500100031135']) }));
    expect(init.headers).toEqual({ authorization: 'Bearer tracking-secret', accept: 'application/json', 'content-type': 'application/json' });
    expect(JSON.stringify([url, init])).not.toContain('ecom-secret');
    expect(JSON.stringify([url, init])).not.toContain('counterparty-secret');
  });

  it('rejects more than 50 barcodes and invalid input before the network', async () => {
    const fetchFn = vi.fn();
    const client = new UkrposhtaStatusTrackingClient({ trackingBearer: 'tracking-secret', fetch: fetchFn });
    await expect(client.getLastStatuses(Array.from({ length: 51 }, (_, index) => String(5_000_000_000_000 + index)))).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(client.getLastStatuses(['../secret'])).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('accepts the documented international Ukrposhta barcode format', async () => {
    const international = { ...event, barcode: 'RA067022855UA' };
    const fetchFn = vi.fn().mockResolvedValue(json({ found: { [international.barcode]: [international] }, notFound: [] }));
    const client = new UkrposhtaStatusTrackingClient({ trackingBearer: 'tracking-secret', fetch: fetchFn });

    await expect(client.getLastStatuses([international.barcode])).resolves.toMatchObject({ found: [{ barcode: international.barcode }] });
  });

  it('retries bounded safe reads and never exposes provider bodies in errors', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json({ bearer: 'leaked', customer: 'private' }, 503))
      .mockResolvedValueOnce(json({ found: { [event.barcode]: [event] }, notFound: [] }));
    const client = new UkrposhtaStatusTrackingClient({ trackingBearer: 'tracking-secret', fetch: fetchFn, sleep });
    await expect(client.getLastStatuses([event.barcode])).resolves.toMatchObject({ found: [{ providerCode: '41000' }] });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(200);

    const unauthorized = new UkrposhtaStatusTrackingClient({ trackingBearer: 'tracking-secret', fetch: vi.fn().mockResolvedValue(json({ bearer: 'leaked' }, 401)) });
    await expect(unauthorized.getLastStatuses([event.barcode])).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'Ukrposhta tracking request failed (UNAUTHORIZED)' });
  });

  it('bounds and validates the complete response before returning safe events', async () => {
    const oversized = new UkrposhtaStatusTrackingClient({
      trackingBearer: 'tracking-secret',
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ found: {}, notFound: [], padding: 'x'.repeat(1024 * 1024) }), { headers: { 'content-type': 'application/json' } })),
    });
    await expect(oversized.getLastStatuses([event.barcode])).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const malformed = new UkrposhtaStatusTrackingClient({ trackingBearer: 'tracking-secret', fetch: vi.fn().mockResolvedValue(json({ found: { [event.barcode]: [{ ...event, barcode: '0500100031135' }] }, notFound: [] })) });
    await expect(malformed.getLastStatuses([event.barcode])).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('removes credential-shaped fields from the persisted provider snapshot', async () => {
    const unsafe = { ...event, token: 'counterparty-secret', authorization: 'Bearer tracking-secret', nested: { bearer: 'ecom-secret', useful: 'kept' } };
    const client = new UkrposhtaStatusTrackingClient({ trackingBearer: 'tracking-secret', fetch: vi.fn().mockResolvedValue(json({ found: { [event.barcode]: [unsafe] }, notFound: [] })) });

    const result = await client.getLastStatuses([event.barcode]);
    expect(result.found[0]?.raw).toMatchObject({ barcode: event.barcode, nested: { useful: 'kept' } });
    expect(JSON.stringify(result)).not.toMatch(/counterparty-secret|tracking-secret|ecom-secret/);
  });

  it('maps timeout and network failures to safe retryable codes', async () => {
    const timeout = new UkrposhtaStatusTrackingClient({ trackingBearer: 'tracking-secret', fetch: vi.fn().mockRejectedValue(new DOMException('tracking-secret', 'TimeoutError')), sleep: vi.fn().mockResolvedValue(undefined) });
    await expect(timeout.getLastStatuses([event.barcode])).rejects.toMatchObject({ code: 'TIMEOUT', message: 'Ukrposhta tracking request failed (TIMEOUT)' });
  });
});

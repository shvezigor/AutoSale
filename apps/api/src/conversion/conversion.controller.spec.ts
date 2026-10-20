import { describe, expect, it, vi } from 'vitest';

import { ConversionController } from './conversion.controller.js';

describe('ConversionController', () => {
  it('rejects identifiers, server-only events and oversized bodies before persistence', async () => {
    const recordAnonymous = vi.fn();
    const controller = new ConversionController({ recordAnonymous } as never);
    const request = { ip: '192.0.2.10', rawBody: Buffer.from('{}') };
    await expect(controller.record({ event: 'pricing_view', locale: 'uk', email: 'fictional@example.test' }, request as never)).rejects.toMatchObject({ status: 400 });
    await expect(controller.record({ event: 'account_registered', locale: 'uk' }, request as never)).rejects.toMatchObject({ status: 400 });
    await expect(controller.record({ event: 'pricing_view', locale: 'uk' }, { ...request, rawBody: Buffer.alloc(2049) } as never)).rejects.toMatchObject({ status: 413 });
    expect(recordAnonymous).not.toHaveBeenCalled();
  });

  it('accepts only the fixed payload and trusted request address', async () => {
    const recordAnonymous = vi.fn();
    const controller = new ConversionController({ recordAnonymous } as never);
    await controller.record({ event: 'plan_interest', locale: 'en', planId: 'growth' }, { ip: '192.0.2.10', rawBody: Buffer.from('{}') } as never);
    expect(recordAnonymous).toHaveBeenCalledWith({ event: 'plan_interest', locale: 'en', planId: 'growth' }, '192.0.2.10');
  });
});

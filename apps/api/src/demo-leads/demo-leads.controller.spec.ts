import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { DemoLeadsController } from './demo-leads.controller.js';

const valid = { name: 'Olena', company: 'Store', email: 'owner@example.com', phone: '', orderVolume: '50_TO_300', note: '', locale: 'en', privacyConsent: true };
const trustedRequest = { ip: '192.0.2.4', rawBody: Buffer.from(JSON.stringify(valid)), headers: { 'x-forwarded-for': '198.51.100.8' } };
const response = () => ({ setHeader: vi.fn() });

describe('DemoLeadsController', () => {
  it('passes a valid public request to the durable service', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'lead', accepted: true });
    const check = vi.fn().mockResolvedValue(undefined);
    const controller = new DemoLeadsController({ create, findAccepted: vi.fn().mockResolvedValue(null) } as never, { check } as never);
    await expect(controller.create(valid, 'request-1', trustedRequest as never, response() as never)).resolves.toEqual({ id: 'lead', accepted: true });
    expect(create).toHaveBeenCalledWith(valid, 'request-1');
    expect(check).toHaveBeenCalledWith({ ipPrefix: '192.0.2.4', contact: 'owner@example.com', idempotencyKey: 'request-1' });
  });
  it('rejects invalid input before persistence', async () => {
    const controller = new DemoLeadsController({ create: vi.fn() } as never, { check: vi.fn() } as never);
    await expect(controller.create({ ...valid, email: '', phone: '' }, 'request-2', trustedRequest as never, response() as never)).rejects.toThrow(BadRequestException);
  });
  it('returns only safe field codes for an invalid public request', async () => {
    const controller = new DemoLeadsController({ create: vi.fn() } as never, { check: vi.fn() } as never);
    try { await controller.create({ ...valid, name: 'A', company: '', email: 'bad', orderVolume: '', privacyConsent: false }, 'request-3', trustedRequest as never, response() as never); }
    catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual(expect.objectContaining({
        code: 'VALIDATION_FAILED',
        issues: expect.arrayContaining([
          { field: 'name', code: 'INVALID_NAME' },
          { field: 'company', code: 'INVALID_COMPANY' },
          { field: 'email', code: 'INVALID_EMAIL' },
          { field: 'orderVolume', code: 'INVALID_ORDER_VOLUME' },
          { field: 'privacyConsent', code: 'CONSENT_REQUIRED' },
        ]),
      }));
      return;
    }
    throw new Error('expected validation error');
  });

  it('returns an accepted replay without consuming another quota', async () => {
    const check = vi.fn();
    const create = vi.fn();
    const controller = new DemoLeadsController({ create, findAccepted: vi.fn().mockResolvedValue({ id: 'prior', accepted: true }) } as never, { check } as never);
    await expect(controller.create(valid, 'same-key', trustedRequest as never, response() as never)).resolves.toEqual({ id: 'prior', accepted: true });
    expect(check).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts a filled honeypot without writing or consuming quota', async () => {
    const create = vi.fn();
    const check = vi.fn();
    const controller = new DemoLeadsController({ create } as never, { check } as never);
    const result = await controller.create({ ...valid, companyWebsite: 'https://spam.example.test' }, 'bot-key', trustedRequest as never, response() as never);
    expect(result).toMatchObject({ accepted: true });
    expect(create).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });

  it('rejects a body larger than 16 KiB before querying the lead', async () => {
    const findAccepted = vi.fn();
    const controller = new DemoLeadsController({ findAccepted } as never, { check: vi.fn() } as never);
    await expect(controller.create(valid, 'key', { ...trustedRequest, rawBody: Buffer.alloc(16_385) } as never, response() as never))
      .rejects.toMatchObject({ status: 413 });
    expect(findAccepted).not.toHaveBeenCalled();
  });

  it('sets Retry-After without leaking a rejected contact', async () => {
    const reply = response();
    const controller = new DemoLeadsController({ findAccepted: vi.fn().mockResolvedValue(null) } as never,
      { check: vi.fn().mockRejectedValue(Object.assign(new Error('DEMO_RATE_LIMITED'), { status: 429, retryAfterSeconds: 42 })) } as never);
    await expect(controller.create(valid, 'key', trustedRequest as never, reply as never)).rejects.toMatchObject({ status: 429 });
    expect(reply.setHeader).toHaveBeenCalledWith('Retry-After', '42');
  });
});

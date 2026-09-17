import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { DemoLeadsController } from './demo-leads.controller.js';

const valid = { name: 'Olena', company: 'Store', email: 'owner@example.com', phone: '', orderVolume: '50_TO_300', note: '', locale: 'en', privacyConsent: true };

describe('DemoLeadsController', () => {
  it('passes a valid public request to the durable service', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'lead', accepted: true });
    const controller = new DemoLeadsController({ create } as never);
    await expect(controller.create(valid, 'request-1')).resolves.toEqual({ id: 'lead', accepted: true });
    expect(create).toHaveBeenCalledWith(valid, 'request-1');
  });
  it('rejects invalid input before persistence', () => {
    const controller = new DemoLeadsController({ create: vi.fn() } as never);
    expect(() => controller.create({ ...valid, email: '', phone: '' }, 'request-2')).toThrow(BadRequestException);
  });
});

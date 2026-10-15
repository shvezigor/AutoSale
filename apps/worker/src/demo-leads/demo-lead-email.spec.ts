import { describe, expect, it, vi } from 'vitest';

import { classifyDemoLeadEmailError, createDemoLeadEmailSender, DemoLeadEmailError } from './demo-lead-email.js';

const lead = {
  id: '00000000-0000-4000-8000-000000000001', name: 'Fictional Olena', company: 'Example Store',
  email: 'lead@example.test', phone: null, orderVolume: '50_TO_300', note: null, locale: 'en',
  leaseId: '00000000-0000-4000-8000-000000000002', attempt: 1,
};

describe('demo lead email sender', () => {
  it('uses a stable Message-ID, fictional message body and bounded SMTP timeouts', async () => {
    const sendMail = vi.fn().mockResolvedValue({ accepted: ['internal@example.test'] });
    const transportFactory = vi.fn().mockReturnValue({ sendMail });
    const sender = createDemoLeadEmailSender({
      SMTP_HOST: 'smtp.example.test', SMTP_PORT: 587, SMTP_USER: 'user', SMTP_PASSWORD: 'fictional-password',
      SMTP_FROM: 'noreply@example.test', DEMO_LEAD_EMAIL: 'internal@example.test',
    }, transportFactory);

    await sender.send(lead);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      messageId: `<demo-${lead.id}@sales-aito.com>`,
      to: 'internal@example.test',
      text: expect.stringContaining('Fictional Olena'),
    }));
    expect(transportFactory.mock.calls[0]![0]).toEqual(expect.objectContaining({
      connectionTimeout: expect.any(Number), greetingTimeout: expect.any(Number), socketTimeout: expect.any(Number),
    }));
    for (const timeout of ['connectionTimeout', 'greetingTimeout', 'socketTimeout'] as const) {
      expect(transportFactory.mock.calls[0]![0][timeout]).toBeLessThan(120_000);
    }
  });

  it('never treats missing SMTP configuration as a successful send', async () => {
    const sender = createDemoLeadEmailSender({ SMTP_PORT: 587 });
    await expect(sender.send(lead)).rejects.toMatchObject({ code: 'NOT_CONFIGURED', terminal: true });
  });

  it('classifies permanent SMTP rejections and ambiguous timeouts conservatively', () => {
    expect(classifyDemoLeadEmailError({ responseCode: 550 })).toEqual({ code: 'RECIPIENT_REJECTED', terminal: true });
    expect(classifyDemoLeadEmailError({ responseCode: 450 })).toEqual({ code: 'DELIVERY_FAILED', terminal: false });
    expect(classifyDemoLeadEmailError(new Error('timeout'))).toEqual({ code: 'DELIVERY_FAILED', terminal: false });
    expect(classifyDemoLeadEmailError(new DemoLeadEmailError('NOT_CONFIGURED', true))).toEqual({ code: 'NOT_CONFIGURED', terminal: true });
  });
});

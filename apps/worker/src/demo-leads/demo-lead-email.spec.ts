import { createServer } from 'node:net';
import { once } from 'node:events';

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
    const close = vi.fn();
    const transportFactory = vi.fn().mockReturnValue({ sendMail, close });
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
    sender.close();
    expect(close).toHaveBeenCalledOnce();
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

  it('delivers a fictional notification to a loopback-only SMTP sink', async () => {
    const messages: string[] = [];
    const sockets = new Set<import('node:net').Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.setEncoding('utf8');
      socket.write('220 localhost ESMTP\r\n');
      let buffer = '';
      let body = '';
      let readingBody = false;
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        let end = buffer.indexOf('\r\n');
        while (end >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (readingBody) {
            if (line === '.') {
              messages.push(body);
              body = '';
              readingBody = false;
              socket.write('250 2.0.0 accepted\r\n');
            } else body += `${line}\r\n`;
          } else if (line.startsWith('EHLO')) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
          else if (line.startsWith('AUTH PLAIN')) socket.write('235 2.7.0 authenticated\r\n');
          else if (line.startsWith('MAIL FROM')) socket.write('250 2.1.0 sender accepted\r\n');
          else if (line.startsWith('RCPT TO')) socket.write('250 2.1.5 recipient accepted\r\n');
          else if (line === 'DATA') { readingBody = true; socket.write('354 continue\r\n'); }
          else if (line === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
          else socket.write('250 ok\r\n');
          end = buffer.indexOf('\r\n');
        }
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('SMTP_SINK_ADDRESS_MISSING');
      const sender = createDemoLeadEmailSender({
        SMTP_HOST: '127.0.0.1', SMTP_PORT: address.port, SMTP_USER: 'fictional-user',
        SMTP_PASSWORD: 'fictional-password', SMTP_FROM: 'noreply@example.test',
        DEMO_LEAD_EMAIL: 'internal@example.test',
      });
      await sender.send(lead);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(`Message-ID: <demo-${lead.id}@sales-aito.com>`);
      expect(messages[0]).toContain('Fictional Olena');
    } finally {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, 'close');
    }
  }, 15_000);
});

import { describe, expect, it, vi } from 'vitest';
import { SmtpEmailDelivery } from './email-delivery.js';

describe('SmtpEmailDelivery', () => {
  it('sends all auth emails without returning secret URLs', async () => {
    const sendMail = vi.fn(async () => ({ messageId: 'message-1' }));
    const email = new SmtpEmailDelivery({ sendMail }, 'AutoSale <no-reply@example.com>');
    await expect(email.sendVerification('owner@example.com', 'https://app.example.com/verify-email?token=secret')).resolves.toBeUndefined();
    await email.sendPasswordReset('owner@example.com', 'https://app.example.com/reset-password?token=secret');
    await email.sendInvitation('manager@example.com', 'https://app.example.com/invite/secret');
    expect(sendMail).toHaveBeenCalledTimes(3);
    expect(sendMail).toHaveBeenNthCalledWith(1, expect.objectContaining({ from: 'AutoSale <no-reply@example.com>', to: 'owner@example.com', subject: expect.stringContaining('Підтвердіть') }));
  });
});

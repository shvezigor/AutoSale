import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { TelegramWebhookController } from './telegram-webhook.controller.js';

describe('TelegramWebhookController', () => {
  it('rejects a missing or invalid secret without invoking the service', async () => {
    const handleWebhook = vi.fn();
    const controller = new TelegramWebhookController({ handleWebhook } as never, 'expected-secret-value-with-32-chars');

    await expect(controller.webhook(undefined, { update_id: 1 })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.webhook('wrong-secret-value-with-32-chars', { update_id: 1 })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(handleWebhook).not.toHaveBeenCalled();
  });

  it('acknowledges a valid secret without reflecting processing details', async () => {
    const handleWebhook = vi.fn().mockResolvedValue('REPLAY');
    const controller = new TelegramWebhookController({ handleWebhook } as never, 'expected-secret-value-with-32-chars');

    await expect(controller.webhook('expected-secret-value-with-32-chars', { update_id: 1 })).resolves.toEqual({ ok: true });
  });
});

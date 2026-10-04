import { describe, expect, it, vi } from 'vitest';

import { TikTokAppWebhookService } from './tiktok-app-webhook.service.js';

describe('TikTokAppWebhookService', () => {
  it('creates or repairs the one DIRECT_MESSAGE webhook and then reports healthy', async () => {
    const client = {
      getDirectMessageWebhook: vi.fn().mockResolvedValue(null),
      updateDirectMessageWebhook: vi.fn().mockResolvedValue({ callbackUrl: 'https://sales-aito.example/webhooks/tiktok' }),
    };
    const service = new TikTokAppWebhookService(
      client as never,
      'https://sales-aito.example',
      true,
    );

    await service.onModuleInit();
    await expect(service.assertHealthy()).resolves.toBeUndefined();
    expect(client.updateDirectMessageWebhook).toHaveBeenCalledWith('https://sales-aito.example/webhooks/tiktok');
  });

  it('does not mutate an already-correct webhook', async () => {
    const client = {
      getDirectMessageWebhook: vi.fn().mockResolvedValue({ callbackUrl: 'https://sales-aito.example/webhooks/tiktok' }),
      updateDirectMessageWebhook: vi.fn(),
    };
    const service = new TikTokAppWebhookService(client as never, 'https://sales-aito.example/', true);
    await service.onModuleInit();
    expect(client.updateDirectMessageWebhook).not.toHaveBeenCalled();
  });

  it('fails closed when reconciliation fails and is a no-op while disabled', async () => {
    const client = {
      getDirectMessageWebhook: vi.fn().mockRejectedValue(new Error('provider details')),
      updateDirectMessageWebhook: vi.fn(),
    };
    const enabled = new TikTokAppWebhookService(client as never, 'https://sales-aito.example', true);
    await expect(enabled.onModuleInit()).rejects.toThrow('TikTok app webhook reconciliation failed');
    await expect(enabled.assertHealthy()).rejects.toThrow('TikTok app webhook is not healthy');

    const disabled = new TikTokAppWebhookService(client as never, 'https://sales-aito.example', false);
    await disabled.onModuleInit();
    expect(client.getDirectMessageWebhook).toHaveBeenCalledTimes(1);
  });
});

import type { TikTokBusinessMessagingClient } from '@autosale/integrations';
import type { OnModuleInit } from '@nestjs/common';

export class TikTokAppWebhookService implements OnModuleInit {
  private readonly callbackUrl: string;
  private healthy = false;

  constructor(
    private readonly client: TikTokBusinessMessagingClient,
    appPublicUrl: string,
    private readonly enabled: boolean,
  ) {
    this.callbackUrl = new URL('/webhooks/tiktok', ensureTrailingSlash(appPublicUrl)).toString();
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    try {
      const current = await this.client.getDirectMessageWebhook();
      if (current?.callbackUrl !== this.callbackUrl) {
        const updated = await this.client.updateDirectMessageWebhook(this.callbackUrl);
        if (updated.callbackUrl !== this.callbackUrl) throw new Error('mismatch');
      }
      this.healthy = true;
    } catch {
      this.healthy = false;
      throw new Error('TikTok app webhook reconciliation failed');
    }
  }

  async assertHealthy(): Promise<void> {
    if (!this.enabled || !this.healthy) throw new Error('TikTok app webhook is not healthy');
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

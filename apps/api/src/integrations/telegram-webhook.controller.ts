import { createHash, timingSafeEqual } from 'node:crypto';

import { Body, Controller, Headers, Inject, Post, UnauthorizedException } from '@nestjs/common';

import { Public, SkipCsrf } from '../auth/auth.decorators.js';
import { TelegramService } from './telegram.service.js';

export const TELEGRAM_WEBHOOK_SECRET = Symbol('TELEGRAM_WEBHOOK_SECRET');

@Controller('api/integrations/telegram')
export class TelegramWebhookController {
  constructor(
    @Inject(TelegramService) private readonly telegram: TelegramService,
    @Inject(TELEGRAM_WEBHOOK_SECRET) private readonly webhookSecret: string | undefined,
  ) {}

  @Post('webhook')
  @Public()
  @SkipCsrf()
  async webhook(@Headers('x-telegram-bot-api-secret-token') supplied: string | undefined, @Body() body: unknown) {
    if (!this.webhookSecret || !safeEqual(supplied, this.webhookSecret)) throw new UnauthorizedException('Invalid Telegram webhook');
    await this.telegram.handleWebhook(body);
    return { ok: true };
  }
}

function safeEqual(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

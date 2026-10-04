import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { Public } from '../auth/auth.decorators.js';
import { SOCIAL_INBOUND_QUEUE } from '../queue/queue.module.js';
import { TikTokEventService } from './tiktok-event.service.js';
import { TikTokSignatureService } from './tiktok-signature.service.js';

export const TIKTOK_WEBHOOK_CONFIG = Symbol('TIKTOK_WEBHOOK_CONFIG');

export interface TikTokWebhookConfig {
  appId: string;
  enabled: boolean;
}

interface NormalizeQueue {
  add(
    name: 'tiktok.normalize',
    data: { tenantId: string; eventId: string; correlationId: string },
    options: { jobId: string; removeOnFail: true },
  ): Promise<unknown>;
}

const MESSAGE_EVENTS = new Set(['im_receive_msg', 'im_receive_msg_eu', 'im_send_msg']);

@Controller('webhooks/tiktok')
@Public()
export class TikTokWebhookController {
  constructor(
    @Inject(TIKTOK_WEBHOOK_CONFIG) private readonly config: TikTokWebhookConfig,
    @Inject(TikTokSignatureService) private readonly signatures: TikTokSignatureService,
    @Inject(TikTokEventService) private readonly events: TikTokEventService,
    @Inject(SOCIAL_INBOUND_QUEUE) private readonly queue: NormalizeQueue,
  ) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Req() request: RawBodyRequest<IncomingMessage>,
    @Headers('tiktok-signature') signature: string | undefined,
    @Body() payload: unknown,
  ): Promise<{ received: true }> {
    if (!this.config.enabled) throw new NotFoundException();
    if (!request.rawBody || !signature || !this.signatures.verify(request.rawBody, signature)) {
      throw new UnauthorizedException();
    }
    if (!isRecord(payload)) throw new BadRequestException('Malformed TikTok webhook payload');
    if (payload.client_key !== this.config.appId) throw new UnauthorizedException();
    if (typeof payload.event !== 'string' || !MESSAGE_EVENTS.has(payload.event)) return { received: true };

    const webhook = validateMessageEvent(payload);
    const tenantId = await this.events.resolveTenant(webhook.accountId);
    if (!tenantId) return { received: true };
    const registered = await this.events.register({
      tenantId,
      externalEventId: webhook.externalEventId,
      payload,
    });
    if (registered.pending && registered.eventId) {
      try {
        await this.queue.add(
          'tiktok.normalize',
          { tenantId, eventId: registered.eventId, correlationId: registered.eventId },
          { jobId: registered.eventId, removeOnFail: true },
        );
      } catch {
        // RECEIVED remains the durable dispatch record for provider retry/reconciliation.
      }
    }
    return { received: true };
  }
}

function validateMessageEvent(payload: Record<string, unknown>): {
  accountId: string;
  externalEventId: string;
} {
  if (
    typeof payload.user_openid !== 'string' || payload.user_openid.length === 0 ||
    typeof payload.create_time !== 'number' || !Number.isSafeInteger(payload.create_time) ||
    typeof payload.content !== 'string'
  ) throw new BadRequestException('Malformed TikTok message event');

  let content: unknown;
  try {
    content = JSON.parse(payload.content);
  } catch {
    throw new BadRequestException('Malformed TikTok message content');
  }
  if (
    !isRecord(content) ||
    typeof content.message_id !== 'string' || content.message_id.length === 0 ||
    typeof content.conversation_id !== 'string' || content.conversation_id.length === 0 ||
    typeof content.timestamp !== 'number' || !Number.isSafeInteger(content.timestamp) ||
    typeof content.type !== 'string' || content.type.length === 0
  ) throw new BadRequestException('Malformed TikTok message content');

  const safeMessageId = content.message_id.length <= 512 && !/[\u0000-\u001f\u007f]/.test(content.message_id)
    ? content.message_id
    : createHash('sha256').update(payload.content).digest('hex');
  return {
    accountId: payload.user_openid,
    externalEventId: `tiktok:${safeMessageId}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

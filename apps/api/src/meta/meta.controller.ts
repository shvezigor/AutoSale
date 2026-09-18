import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Query,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { INSTAGRAM_NORMALIZE_QUEUE } from '../queue/queue.module.js';
import { Public } from '../auth/auth.decorators.js';
import { MetaEventService } from './meta-event.service.js';
import { MetaSignatureService } from './meta-signature.service.js';

export const META_WEBHOOK_CONFIG = Symbol('META_WEBHOOK_CONFIG');

export interface MetaWebhookConfig {
  verifyToken: string;
}

interface NormalizeQueue {
  add(
    name: 'instagram.normalize',
    data: { eventId: string; correlationId: string },
    options: { jobId: string; removeOnFail: true },
  ): Promise<unknown>;
}

@Controller('webhooks/meta')
@Public()
export class MetaController {
  constructor(
    @Inject(META_WEBHOOK_CONFIG) private readonly config: MetaWebhookConfig,
    @Inject(MetaSignatureService) private readonly signatures: MetaSignatureService,
    @Inject(MetaEventService) private readonly events: MetaEventService,
    @Inject(INSTAGRAM_NORMALIZE_QUEUE) private readonly queue: NormalizeQueue,
  ) {}

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
  ): string {
    if (mode !== 'subscribe' || token !== this.config.verifyToken || !challenge) {
      throw new ForbiddenException();
    }

    return challenge;
  }

  @Post()
  @HttpCode(200)
  async receiveWebhook(
    @Req() request: RawBodyRequest<IncomingMessage>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() payload: Record<string, unknown>,
  ): Promise<{ received: true }> {
    if (!request.rawBody || !signature || !this.signatures.verify(request.rawBody, signature)) {
      throw new UnauthorizedException();
    }

    const entries = validateInstagramEntries(payload);
    for (const entry of entries) {
      const tenantId = await this.events.resolveTenant(entry.id);
      if (!tenantId) continue;

      const entryPayload = { object: 'instagram', entry: [entry] };
      const externalEventId = deriveExternalEventId(entryPayload, tenantId);
      const registered = await this.events.register({
        tenantId,
        externalEventId,
        payload: entryPayload,
      });

      if (registered.pending) {
        void this.dispatch(registered.eventId);
      }
    }

    return { received: true };
  }

  private async dispatch(eventId: string): Promise<void> {
    try {
      await this.queue.add(
        'instagram.normalize',
        { eventId, correlationId: eventId },
        { jobId: eventId, removeOnFail: true },
      );
    } catch {
      // RECEIVED is the durable dispatch record; Meta retry or the reconciler will retry.
    }
  }
}

interface InstagramEntry extends Record<string, unknown> {
  id: string;
}

function validateInstagramEntries(payload: Record<string, unknown>): InstagramEntry[] {
  if (payload.object !== 'instagram' || !Array.isArray(payload.entry)) {
    throw new BadRequestException('Malformed Instagram webhook payload');
  }

  return payload.entry.map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new BadRequestException('Instagram webhook entry requires an account id');
    }
    return entry as InstagramEntry;
  });
}

function deriveExternalEventId(payload: Record<string, unknown>, tenantId: string): string {
  const messageIds = collectMessageIds(payload);
  if (messageIds.length === 1) {
    return messageIds[0]!;
  }

  const canonical = stableStringify({ tenantId, payload });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function collectMessageIds(payload: Record<string, unknown>): string[] {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const ids: string[] = [];

  for (const entry of entries) {
    if (!isRecord(entry) || !Array.isArray(entry.messaging)) continue;
    for (const item of entry.messaging) {
      if (!isRecord(item) || !isRecord(item.message)) continue;
      if (typeof item.message.mid === 'string' && item.message.mid.length > 0) {
        ids.push(item.message.mid);
      }
    }
  }

  return [...new Set(ids)].sort();
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

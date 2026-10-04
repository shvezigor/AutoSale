import type { PrismaClient } from '@autosale/database';

import {
  SocialInboundIngestionService,
  type SocialMediaCopier,
  type SocialOrderTriggerProcessor,
} from '../social/social-inbound-ingestion.service.js';
import { normalizeTikTokEvent } from './tiktok-normalizer.js';

export class TikTokProcessor {
  private readonly ingestion: SocialInboundIngestionService;

  constructor(
    prisma: PrismaClient,
    media: SocialMediaCopier,
    orders?: SocialOrderTriggerProcessor,
  ) {
    this.ingestion = new SocialInboundIngestionService(prisma, media, orders);
  }

  process(tenantId: string, eventId: string): Promise<'PROCESSED' | 'IGNORED_FROZEN'> {
    return this.ingestion.process(tenantId, eventId, normalizeTikTokEvent);
  }
}

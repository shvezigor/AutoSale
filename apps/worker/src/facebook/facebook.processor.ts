import type { PrismaClient } from '@autosale/database';

import {
  SocialInboundIngestionService,
  type SocialMediaCopier,
  type SocialOrderTriggerProcessor,
  type SocialReplyDraftScheduler,
} from '../social/social-inbound-ingestion.service.js';
import { normalizeFacebookEvent } from './facebook-normalizer.js';

export class FacebookProcessor {
  private readonly ingestion: SocialInboundIngestionService;

  constructor(
    prisma: PrismaClient,
    media: SocialMediaCopier,
    orders?: SocialOrderTriggerProcessor,
    replyDrafts?: SocialReplyDraftScheduler,
  ) {
    this.ingestion = new SocialInboundIngestionService(prisma, media, orders, replyDrafts);
  }

  process(tenantId: string, eventId: string): Promise<'PROCESSED' | 'IGNORED_FROZEN'> {
    return this.ingestion.process(tenantId, eventId, normalizeFacebookEvent);
  }
}

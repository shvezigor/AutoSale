import type { AuthPrincipal } from '@autosale/contracts/auth';
import { createReplyDraftSchema } from '@autosale/contracts/reply-drafts';
import { Body, Controller, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { validationBadRequest } from '../common/validation-error.js';
import { ReplyDraftsService } from './reply-drafts.service.js';

@Controller('api/conversations/:id/reply-drafts')
@RequireMembership('MANAGER')
export class ReplyDraftsController {
  constructor(@Inject(ReplyDraftsService) private readonly drafts: ReplyDraftsService) {}

  @Post()
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) conversationId: string,
    @Body() body: unknown,
  ) {
    const parsed = createReplyDraftSchema.safeParse(body);
    if (!parsed.success) throw validationBadRequest(parsed.error, { idempotencyKey: 'INVALID_REQUEST_KEY' });
    return this.drafts.create(principal.tenantId!, principal.userId, conversationId, parsed.data.idempotencyKey);
  }
}

import type { AuthPrincipal } from '@autosale/contracts/auth';
import { replyStylePatchSchema } from '@autosale/contracts/reply-drafts';
import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { validationBadRequest } from '../common/validation-error.js';
import { ReplyStyleService } from './reply-style.service.js';

@Controller('api/settings/reply-style')
@RequireMembership('MANAGER')
export class ReplyStyleController {
  constructor(@Inject(ReplyStyleService) private readonly style: ReplyStyleService) {}

  @Get()
  get(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.style.get(principal.tenantId!);
  }

  @Patch()
  @RequireMembership('OWNER')
  update(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    const parsed = replyStylePatchSchema.safeParse(body);
    if (!parsed.success) throw validationBadRequest(parsed.error, {
      enabled: 'INVALID_ENABLED_FLAG', companyName: 'INVALID_COMPANY_NAME',
      tone: 'INVALID_TONE', addressForm: 'INVALID_ADDRESS_FORM', guidance: 'INVALID_GUIDANCE',
    });
    return this.style.update(principal.tenantId!, parsed.data);
  }
}

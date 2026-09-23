import type { AuthPrincipal } from '@autosale/contracts/auth';
import { commercialTermsUpdateSchema } from '@autosale/contracts/commercial';
import { Body, Controller, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { CommercialTermsService } from './commercial-terms.service.js';
import { validationBadRequest } from '../common/validation-error.js';

@Controller('api/orders')
@RequireMembership('MANAGER')
export class CommercialTermsController {
  constructor(@Inject(CommercialTermsService) private readonly commercial: CommercialTermsService) {}

  @Post(':id/commercial-terms/preview')
  preview(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.commercial.preview(principal.tenantId!, id);
  }

  @Put(':id/commercial-terms')
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: unknown,
  ) {
    const parsed = commercialTermsUpdateSchema.safeParse(body);
    if (!parsed.success) throw validationBadRequest(parsed.error, { version: 'INVALID_VERSION', legalEntityId: 'INVALID_LEGAL_ENTITY', bankAccountId: 'INVALID_BANK_ACCOUNT', initializeLegacy: 'INVALID_LEGACY_FLAG' });
    return this.commercial.update(principal.tenantId!, id, principal.userId, parsed.data);
  }
}

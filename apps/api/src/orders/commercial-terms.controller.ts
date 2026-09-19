import type { AuthPrincipal } from '@autosale/contracts/auth';
import { commercialTermsUpdateSchema } from '@autosale/contracts/commercial';
import { BadRequestException, Body, Controller, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { CommercialTermsService } from './commercial-terms.service.js';

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
    if (!parsed.success) throw new BadRequestException('Invalid commercial terms');
    return this.commercial.update(principal.tenantId!, id, principal.userId, parsed.data);
  }
}

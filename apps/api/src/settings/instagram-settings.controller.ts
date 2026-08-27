import { instagramConnectionRequestSchema, type AuthPrincipal } from '@autosale/contracts/auth';
import { BadRequestException, Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { InstagramSettingsService } from './instagram-settings.service.js';

@Controller('api/settings/instagram')
@RequireMembership('OWNER')
export class InstagramSettingsController {
  constructor(@Inject(InstagramSettingsService) private readonly settings: InstagramSettingsService) {}
  @Get() get(@CurrentPrincipal() principal: AuthPrincipal) { return this.settings.get(principal.tenantId!); }
  @Patch() update(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    const parsed = instagramConnectionRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid Instagram connection');
    return this.settings.update(principal.tenantId!, parsed.data);
  }
}

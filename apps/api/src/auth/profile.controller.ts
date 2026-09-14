import type { AuthPrincipal } from '@autosale/contracts/auth';
import { updateProfileRequestSchema } from '@autosale/contracts/profile';
import { BadRequestException, Body, Controller, Get, Inject, Patch } from '@nestjs/common';

import { CurrentPrincipal } from './auth.decorators.js';
import { ProfileService } from './profile.service.js';

@Controller('api/profile')
export class ProfileController {
  constructor(@Inject(ProfileService) private readonly profiles: ProfileService) {}

  @Get()
  get(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.profiles.get(principal);
  }

  @Patch()
  update(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    const parsed = updateProfileRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('PROFILE_INVALID');
    return this.profiles.update(principal, parsed.data);
  }
}

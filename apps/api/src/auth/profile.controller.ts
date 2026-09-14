import type { AuthPrincipal } from '@autosale/contracts/auth';
import { changePasswordRequestSchema, updateProfileRequestSchema } from '@autosale/contracts/profile';
import { BadRequestException, Body, Controller, Get, Inject, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { CurrentPrincipal } from './auth.decorators.js';
import { ProfileService } from './profile.service.js';
import { RateLimitService } from './rate-limit.service.js';

@Controller('api/profile')
export class ProfileController {
  constructor(
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
  ) {}

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

  @Post('password')
  async changePassword(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const parsed = changePasswordRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('PROFILE_PASSWORD_INVALID');
    const ip = request.ip || request.socket?.remoteAddress || 'unknown';
    await this.rateLimit.consume(
      'profile-password',
      ip.slice(0, 64),
      principal.email.trim().toLowerCase(),
      5,
      15 * 60,
    );
    return this.profiles.changePassword(principal, parsed.data);
  }
}

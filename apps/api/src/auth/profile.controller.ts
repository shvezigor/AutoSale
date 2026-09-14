import type { AuthPrincipal } from '@autosale/contracts/auth';
import { changePasswordRequestSchema, updateProfileRequestSchema } from '@autosale/contracts/profile';
import { BadRequestException, Body, Controller, Delete, Get, Inject, Patch, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';

import { CurrentPrincipal } from './auth.decorators.js';
import { ProfileService, type ProfileAvatarFile } from './profile.service.js';
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

  @Post('avatar')
  @UseInterceptors(FileInterceptor('avatar', { limits: { files: 1, fileSize: 5 * 1024 * 1024 } }))
  async replaceAvatar(
    @CurrentPrincipal() principal: AuthPrincipal,
    @UploadedFile() file: ProfileAvatarFile | undefined,
    @Req() request: Request,
  ) {
    if (!file) throw new BadRequestException('PROFILE_AVATAR_REQUIRED');
    await this.limitAvatar(principal, request);
    return this.profiles.replaceAvatar(principal, file);
  }

  @Delete('avatar')
  async removeAvatar(@CurrentPrincipal() principal: AuthPrincipal, @Req() request: Request) {
    await this.limitAvatar(principal, request);
    return this.profiles.removeAvatar(principal);
  }

  private limitAvatar(principal: AuthPrincipal, request: Request): Promise<void> {
    const ip = request.ip || request.socket?.remoteAddress || 'unknown';
    return this.rateLimit.consume(
      'profile-avatar',
      ip.slice(0, 64),
      principal.email.trim().toLowerCase(),
      20,
      60 * 60,
    );
  }
}

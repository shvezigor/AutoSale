import type { AuthPrincipal } from '@autosale/contracts/auth';
import { Controller, Get, Header, Inject, Param, ParseUUIDPipe, StreamableFile } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { MediaService } from './media.service.js';

@ApiTags('media')
@Controller('api/media')
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Get('instagram-profiles/:id/avatar')
  @RequireMembership('MANAGER')
  @Header('Cache-Control', 'private, max-age=3600')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Read a cached Instagram customer avatar' })
  @ApiOkResponse({ description: 'Controlled profile avatar bytes' })
  async profileAvatar(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<StreamableFile> {
    const avatar = await this.media.loadProfileAvatar(principal.tenantId!, id);
    return new StreamableFile(avatar.body, { type: avatar.contentType, disposition: 'inline' });
  }

  @Get('profile/avatar')
  @Header('Cache-Control', 'private, max-age=3600')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Read the current user profile avatar' })
  @ApiOkResponse({ description: 'Controlled user avatar bytes' })
  async userAvatar(@CurrentPrincipal() principal: AuthPrincipal): Promise<StreamableFile> {
    const avatar = await this.media.loadUserAvatar(principal.userId);
    return new StreamableFile(avatar.body, { type: avatar.contentType, disposition: 'inline' });
  }

  @Get(':id')
  @RequireMembership('MANAGER')
  @ApiOperation({ summary: 'Read a copied conversation attachment' })
  @ApiOkResponse({ description: 'Controlled attachment bytes' })
  async get(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<StreamableFile> {
    const media = await this.media.load(principal.tenantId!, id);
    return new StreamableFile(media.body, {
      type: media.contentType,
      disposition: 'inline',
    });
  }
}

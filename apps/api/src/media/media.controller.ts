import type { AuthPrincipal } from '@autosale/contracts/auth';
import { Controller, Get, Inject, Param, ParseUUIDPipe, StreamableFile } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { MediaService } from './media.service.js';

@ApiTags('media')
@Controller('api/media')
@RequireMembership('MANAGER')
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Get(':id')
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

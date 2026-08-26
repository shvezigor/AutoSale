import { Controller, Get, Inject, Param, ParseUUIDPipe, StreamableFile } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { MediaService } from './media.service.js';

@ApiTags('media')
@Controller('api/media')
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Read a copied conversation attachment' })
  @ApiOkResponse({ description: 'Controlled attachment bytes' })
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<StreamableFile> {
    const media = await this.media.load(id);
    return new StreamableFile(media.body, {
      type: media.contentType,
      disposition: 'inline',
    });
  }
}

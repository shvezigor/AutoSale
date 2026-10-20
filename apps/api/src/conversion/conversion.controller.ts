import { conversionEventSchema } from '@autosale/contracts';
import { BadRequestException, Body, Controller, HttpCode, HttpException, HttpStatus, Inject, Post, Req, ServiceUnavailableException, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { Public } from '../auth/auth.decorators.js';
import { ConversionService } from './conversion.service.js';

@Controller('api/conversion/events')
@Public()
export class ConversionController {
  constructor(@Inject(ConversionService) private readonly conversions: ConversionService) {}

  @Post()
  @HttpCode(204)
  async record(@Body() body: unknown, @Req() request: RawBodyRequest<Request>): Promise<void> {
    const bytes = request.rawBody?.length ?? Buffer.byteLength(JSON.stringify(body) ?? '');
    if (bytes > 2048) throw new HttpException('CONVERSION_EVENT_TOO_LARGE', HttpStatus.PAYLOAD_TOO_LARGE);
    const parsed = conversionEventSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('CONVERSION_EVENT_INVALID');
    if (!request.ip) throw new ServiceUnavailableException('CONVERSION_RATE_LIMITER_UNAVAILABLE');
    await this.conversions.recordAnonymous(parsed.data, request.ip);
  }
}

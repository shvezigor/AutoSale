import { demoLeadInputSchema } from '@autosale/contracts';
import { BadRequestException, Body, Controller, Headers, Inject, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/auth.decorators.js';
import { validationBadRequest } from '../common/validation-error.js';
import { DemoLeadsService } from './demo-leads.service.js';

@ApiTags('demo-leads')
@Controller('api/demo-leads')
@Public()
export class DemoLeadsController {
  constructor(@Inject(DemoLeadsService) private readonly leads: DemoLeadsService) {}
  @Post()
  create(@Body() body: unknown, @Headers('idempotency-key') idempotencyKey?: string) {
    const parsed = demoLeadInputSchema.safeParse(body);
    if (!parsed.success) throw validationBadRequest(parsed.error, {
      name: 'INVALID_NAME', company: 'INVALID_COMPANY', email: 'INVALID_EMAIL', phone: 'INVALID_PHONE',
      orderVolume: 'INVALID_ORDER_VOLUME', privacyConsent: 'CONSENT_REQUIRED',
    });
    if (!idempotencyKey || idempotencyKey.length > 100) throw new BadRequestException('Invalid demo request');
    return this.leads.create(parsed.data, idempotencyKey);
  }
}

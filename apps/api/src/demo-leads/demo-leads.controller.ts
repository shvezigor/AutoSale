import { demoLeadInputSchema } from '@autosale/contracts';
import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, Controller, Headers, HttpException, HttpStatus, Inject, Post, Req, Res, ServiceUnavailableException, type RawBodyRequest } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Public } from '../auth/auth.decorators.js';
import { validationBadRequest } from '../common/validation-error.js';
import { DemoLeadAbuseService } from './demo-lead-abuse.service.js';
import { DemoLeadsService } from './demo-leads.service.js';

@ApiTags('demo-leads')
@Controller('api/demo-leads')
@Public()
export class DemoLeadsController {
  constructor(
    @Inject(DemoLeadsService) private readonly leads: DemoLeadsService,
    @Inject(DemoLeadAbuseService) private readonly abuse: DemoLeadAbuseService,
  ) {}
  @Post()
  async create(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: RawBodyRequest<Request>,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ id: string; accepted: true }> {
    const bytes = request.rawBody?.length ?? Buffer.byteLength(JSON.stringify(body) ?? '');
    if (bytes > 16_384) throw new HttpException('DEMO_REQUEST_TOO_LARGE', HttpStatus.PAYLOAD_TOO_LARGE);
    if (!idempotencyKey || idempotencyKey.length > 100) throw new BadRequestException('Invalid demo request');
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const { companyWebsite, ...payload } = input;
    if (companyWebsite) return { id: randomUUID(), accepted: true };
    const parsed = demoLeadInputSchema.safeParse(payload);
    if (!parsed.success) throw validationBadRequest(parsed.error, {
      name: 'INVALID_NAME', company: 'INVALID_COMPANY', email: 'INVALID_EMAIL', phone: 'INVALID_PHONE',
      orderVolume: 'INVALID_ORDER_VOLUME', privacyConsent: 'CONSENT_REQUIRED',
    });
    const accepted = await this.leads.findAccepted(idempotencyKey);
    if (accepted) return accepted;
    const trustedIp = request.ip;
    if (!trustedIp) throw new ServiceUnavailableException('DEMO_RATE_LIMITER_UNAVAILABLE');
    try {
      await this.abuse.check({ ipPrefix: trustedIp, contact: parsed.data.email || parsed.data.phone || '', idempotencyKey });
    } catch (error) {
      if (error && typeof error === 'object' && 'retryAfterSeconds' in error && typeof error.retryAfterSeconds === 'number') {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
    return this.leads.create(parsed.data, idempotencyKey);
  }
}

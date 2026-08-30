import type { AuthPrincipal } from '@autosale/contracts/auth';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import {
  CurrentPrincipal,
  Public,
  RequireMembership,
  SkipCsrf,
} from '../auth/auth.decorators.js';
import {
  InstagramOAuthService,
  INSTAGRAM_CLEANUP_ABANDON_CONFIRMATION,
} from './instagram-oauth.service.js';

const connectRequestSchema = z.object({
  returnPath: z.string().max(2_048).optional(),
}).strict();

const cleanupAbandonRequestSchema = z.object({
  confirmation: z.literal(INSTAGRAM_CLEANUP_ABANDON_CONFIRMATION),
}).strict();

@Controller('api/integrations/instagram')
export class InstagramOAuthController {
  constructor(
    @Inject(InstagramOAuthService)
    private readonly instagram: InstagramOAuthService,
  ) {}

  @Get()
  @RequireMembership('MANAGER')
  getSummary(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.instagram.getSummary(principal.tenantId!);
  }

  @Post('connect')
  @RequireMembership('OWNER')
  connect(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: unknown,
  ) {
    const parsed = connectRequestSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid Instagram connection request');
    return this.instagram.connect(
      principal.tenantId!,
      principal.userId,
      parsed.data.returnPath,
    );
  }

  @Get('callback')
  @Public()
  @SkipCsrf()
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') providerError: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const result = await this.instagram.completeCallback(
        code,
        state ?? '',
        providerError === 'access_denied',
      );
      response.redirect(appendResult(result.returnPath, 'connected'));
    } catch {
      response.redirect('/settings?instagram=error');
    }
  }

  @Post('disconnect')
  @RequireMembership('OWNER')
  disconnect(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.instagram.disconnect(principal.tenantId!, principal.userId);
  }

  @Post('cleanup')
  @RequireMembership('OWNER')
  retryCleanup(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.instagram.retryCleanup(principal.tenantId!, principal.userId);
  }

  @Post('cleanup/dead-letter')
  @RequireMembership('OWNER')
  deadLetterCleanup(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: unknown,
  ) {
    const parsed = cleanupAbandonRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid Instagram cleanup confirmation');
    return this.instagram.deadLetterCleanup(principal.tenantId!, principal.userId, parsed.data.confirmation);
  }
}

function appendResult(returnPath: string, result: 'connected'): string {
  try {
    const url = new URL(returnPath, 'https://autosale.local');
    if (url.origin !== 'https://autosale.local') return `/settings?instagram=${result}`;
    url.searchParams.set('instagram', result);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return `/settings?instagram=${result}`;
  }
}

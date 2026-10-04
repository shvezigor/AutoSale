import type { AuthPrincipal } from '@autosale/contracts/auth';
import { BadRequestException, Body, Controller, Delete, Get, Inject, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import { CurrentPrincipal, Public, RequireMembership, SkipCsrf } from '../auth/auth.decorators.js';
import { TikTokOAuthService } from './tiktok-oauth.service.js';

const authorizeRequestSchema = z.object({ returnPath: z.string().max(2_048).optional() }).strict();

@Controller('api/integrations/tiktok')
export class TikTokOAuthController {
  constructor(@Inject(TikTokOAuthService) private readonly tikTok: TikTokOAuthService) {}

  @Get()
  @RequireMembership('MANAGER')
  getSummary(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.tikTok.getSummary(principal.tenantId!);
  }

  @Post('authorize')
  @RequireMembership('OWNER')
  authorize(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    const parsed = authorizeRequestSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid TikTok connection request');
    return this.tikTok.authorize(principal.tenantId!, principal.userId, parsed.data.returnPath);
  }

  @Get('callback')
  @Public()
  @SkipCsrf()
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const result = await this.tikTok.completeCallback(code, state ?? '');
      response.redirect(appendResult(result.returnPath, 'connected'));
    } catch {
      response.redirect('/settings?tab=social&tiktok=error');
    }
  }

  @Delete('connection')
  @RequireMembership('OWNER')
  disconnect(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.tikTok.disconnect(principal.tenantId!, principal.userId);
  }

  @Post('cleanup/retry')
  @RequireMembership('OWNER')
  retryCleanup(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.tikTok.retryCleanup(principal.tenantId!, principal.userId);
  }
}

function appendResult(returnPath: string, result: 'connected'): string {
  try {
    const url = new URL(returnPath, 'https://sales-aito.local');
    if (url.origin !== 'https://sales-aito.local') return fallbackResult(result);
    url.searchParams.set('tiktok', result);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallbackResult(result);
  }
}

function fallbackResult(result: 'connected'): string {
  return `/settings?${new URLSearchParams({ tab: 'social', tiktok: result }).toString()}`;
}

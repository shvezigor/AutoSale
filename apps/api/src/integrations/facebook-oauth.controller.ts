import type { AuthPrincipal } from '@autosale/contracts/auth';
import { facebookPageSelectionInputSchema } from '@autosale/contracts/facebook';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import { CurrentPrincipal, Public, RequireMembership, SkipCsrf } from '../auth/auth.decorators.js';
import { FacebookOAuthService } from './facebook-oauth.service.js';

const authorizeRequestSchema = z.object({
  returnPath: z.string().max(2_048).optional(),
}).strict();

const selectionQuerySchema = z.object({ attemptId: z.string().uuid() }).strict();

@Controller('api/integrations/facebook')
export class FacebookOAuthController {
  constructor(
    @Inject(FacebookOAuthService)
    private readonly facebook: FacebookOAuthService,
  ) {}

  @Get()
  @RequireMembership('MANAGER')
  getSummary(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.facebook.getSummary(principal.tenantId!);
  }

  @Post('authorize')
  @RequireMembership('OWNER')
  authorize(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    const parsed = authorizeRequestSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid Facebook connection request');
    return this.facebook.authorize(principal.tenantId!, principal.userId, parsed.data.returnPath);
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
      const result = await this.facebook.completeCallback(
        code,
        state ?? '',
        providerError === 'access_denied',
      );
      if (result.kind === 'PAGE_SELECTION_REQUIRED') {
        response.redirect(appendResult(result.returnPath, 'select-page', result.attemptId));
        return;
      }
      response.redirect(appendResult(result.returnPath, 'connected'));
    } catch {
      response.redirect('/settings?tab=social&facebook=error');
    }
  }

  @Get('selection')
  @RequireMembership('OWNER')
  getSelection(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: unknown) {
    const parsed = selectionQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid Facebook Page selection');
    return this.facebook.getPageCandidates(principal.tenantId!, principal.userId, parsed.data.attemptId);
  }

  @Post('selection')
  @RequireMembership('OWNER')
  selectPage(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    const parsed = facebookPageSelectionInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid Facebook Page selection');
    return this.facebook.selectPage(principal.tenantId!, principal.userId, parsed.data);
  }

  @Delete()
  @RequireMembership('OWNER')
  disconnect(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.facebook.disconnect(principal.tenantId!, principal.userId);
  }

  @Post('cleanup/retry')
  @RequireMembership('OWNER')
  retryCleanup(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.facebook.retryCleanup(principal.tenantId!, principal.userId);
  }
}

function appendResult(
  returnPath: string,
  result: 'connected' | 'select-page',
  attemptId?: string,
): string {
  try {
    const url = new URL(returnPath, 'https://sales-aito.local');
    if (url.origin !== 'https://sales-aito.local') return fallbackResult(result, attemptId);
    url.searchParams.set('facebook', result);
    if (attemptId) url.searchParams.set('attemptId', attemptId);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallbackResult(result, attemptId);
  }
}

function fallbackResult(result: 'connected' | 'select-page', attemptId?: string): string {
  const params = new URLSearchParams({ tab: 'social', facebook: result });
  if (attemptId) params.set('attemptId', attemptId);
  return `/settings?${params.toString()}`;
}

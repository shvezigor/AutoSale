import type { AuthPrincipal } from '@autosale/contracts/auth';
import { BadRequestException, Body, Controller, Get, Inject, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import { CurrentPrincipal, Public, RequireMembership, SkipCsrf } from '../auth/auth.decorators.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { GoogleCredentialCleanupService } from './google-credential-cleanup.service.js';

const connectSchema = z.object({ returnPath: z.string().max(2_048).optional() }).strict();

@Controller('api/integrations/google')
export class GoogleOAuthController {
  constructor(
    @Inject(GoogleOAuthService) private readonly google: GoogleOAuthService,
    @Inject(GoogleCredentialCleanupService) private readonly cleanup: GoogleCredentialCleanupService,
  ) {}

  @Get()
  @RequireMembership('MANAGER')
  summary(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.google.summary(principal.tenantId!);
  }

  @Post('connect')
  @RequireMembership('OWNER')
  connect(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    const parsed = connectSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid Google connection request');
    return this.google.start(principal.tenantId!, principal.userId, parsed.data.returnPath);
  }

  @Post('disconnect')
  @RequireMembership('OWNER')
  disconnect(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.cleanup.disconnect(principal.tenantId!, principal.userId);
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
      const result = await this.google.complete({
        ...(code === undefined ? {} : { code }),
        state: state ?? '',
        denied: providerError === 'access_denied',
      });
      response.redirect(appendResult(result.returnPath));
    } catch {
      response.redirect('/settings?google=error');
    }
  }
}

const appendResult = (returnPath: string): string => {
  try {
    const url = new URL(returnPath, 'https://autosale.local');
    if (url.origin !== 'https://autosale.local') return '/settings?google=connected';
    url.searchParams.set('google', 'connected');
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/settings?google=connected';
  }
};

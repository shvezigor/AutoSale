import type { PublicSession } from '@autosale/contracts/auth';
import { BadRequestException, Body, Controller, Get, Inject, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { Public } from './auth.decorators.js';
import { GoogleSignInService } from './google-sign-in.service.js';
import { RateLimitService } from './rate-limit.service.js';

export const GOOGLE_SIGN_IN_HTTP_CONFIG = Symbol('GOOGLE_SIGN_IN_HTTP_CONFIG');
export type GoogleSignInHttpConfig = {
  cookieName: string;
  onboardingCookieName: string;
  production: boolean;
};

const startSchema = z.object({ returnPath: z.string().max(512).optional() }).strict();
const onboardingSchema = z.object({ tenantName: z.string().trim().min(1).max(160) }).strict();

@Controller('api/auth/google')
export class GoogleSignInController {
  constructor(
    @Inject(GoogleSignInService) private readonly google: GoogleSignInService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
    @Inject(GOOGLE_SIGN_IN_HTTP_CONFIG) private readonly config: GoogleSignInHttpConfig,
  ) {}

  @Post('start')
  @Public()
  async start(@Body() body: unknown, @Req() request: Request): Promise<{ authorizationUrl: string }> {
    const input = parse(startSchema, body);
    const ipPrefix = requestMetadata(request).ipPrefix ?? 'unknown';
    await this.rateLimit.consume('google-sign-in', ipPrefix, ipPrefix, 10, 60);
    return this.google.start(input.returnPath);
  }

  @Get('callback')
  @Public()
  async callback(
    @Query() query: { state?: string; code?: string; error?: string },
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    if (!query.state) {
      response.redirect('/login?google=failed');
      return;
    }
    try {
      const result = await this.google.completeCallback({
        state: query.state, ...(query.code ? { code: query.code } : {}), ...(query.error ? { denied: true } : {}),
      }, requestMetadata(request));
      if (result.kind === 'ONBOARDING') {
        response.cookie(this.config.onboardingCookieName, result.grant, cookieOptions(this.config.production, result.expiresAt));
        response.redirect('/onboarding/google');
        return;
      }
      response.cookie(this.config.cookieName, result.sessionResult.rawToken, cookieOptions(this.config.production, result.sessionResult.expiresAt));
      response.redirect(result.returnPath);
    } catch {
      response.redirect(query.error ? '/login?google=cancelled' : '/login?google=failed');
    }
  }

  @Get('onboarding')
  @Public()
  async onboarding(@Req() request: Request): Promise<{ email: string; name: string }> {
    const grant = readCookie(request.headers.cookie, this.config.onboardingCookieName);
    if (!grant) throw new UnauthorizedException('Google onboarding is unavailable');
    try {
      return await this.google.onboardingSummary(grant);
    } catch {
      throw new UnauthorizedException('Google onboarding is unavailable');
    }
  }

  @Post('onboarding')
  @Public()
  async completeOnboarding(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicSession> {
    const input = parse(onboardingSchema, body);
    const grant = readCookie(request.headers.cookie, this.config.onboardingCookieName);
    if (!grant) throw new UnauthorizedException('Google onboarding is unavailable');
    try {
      const result = await this.google.completeOnboarding({ grant, tenantName: input.tenantName }, requestMetadata(request));
      response.cookie(this.config.cookieName, result.sessionResult.rawToken, cookieOptions(this.config.production, result.sessionResult.expiresAt));
      response.clearCookie(this.config.onboardingCookieName, clearCookieOptions(this.config.production));
      return result.sessionResult.session;
    } catch {
      response.clearCookie(this.config.onboardingCookieName, clearCookieOptions(this.config.production));
      throw new UnauthorizedException('Google onboarding is unavailable');
    }
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('Invalid Google Sign-In request');
  return result.data;
}

function cookieOptions(production: boolean, expires: Date) {
  return { httpOnly: true, secure: production, sameSite: 'lax' as const, path: '/', expires };
}

function clearCookieOptions(production: boolean) {
  return { httpOnly: true, secure: production, sameSite: 'lax' as const, path: '/' };
}

function requestMetadata(request: Request): { ipPrefix?: string; userAgent?: string } {
  const ip = request.ip || request.socket?.remoteAddress;
  return {
    ...(ip ? { ipPrefix: ip.slice(0, 64) } : {}),
    ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
  };
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

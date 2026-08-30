import { loginRequestSchema, registerRequestSchema, type AuthPrincipal, type PublicSession } from '@autosale/contracts/auth';
import { BadRequestException, Body, Controller, Get, Inject, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { AuthService } from './auth.service.js';
import { CurrentPrincipal, Public, SkipCsrf } from './auth.decorators.js';
import { CsrfService } from './csrf.service.js';
import { RateLimitService } from './rate-limit.service.js';
import { SessionService } from './session.service.js';

export const AUTH_HTTP_CONFIG = Symbol('AUTH_HTTP_CONFIG');
export interface AuthHttpConfig { cookieName: string; production: boolean }

const tokenSchema = z.object({ token: z.string().min(20) }).strict();
const forgotSchema = z.object({ email: z.string().trim().email() }).strict();
const resetSchema = z.object({ token: z.string().min(20), password: z.string().min(12).max(128) }).strict();

@Controller('api/auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AUTH_HTTP_CONFIG) private readonly config: AuthHttpConfig,
    @Inject(CsrfService) private readonly csrfService: CsrfService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
  ) {}

  @Post('csrf')
  @SkipCsrf()
  csrf(@CurrentPrincipal() principal: AuthPrincipal): { token: string } {
    return { token: this.csrfService.issue(principal.sessionId) };
  }

  @Post('register')
  @Public()
  async register(@Body() body: unknown, @Req() request: Request) {
    const input = parse(registerRequestSchema, body);
    await this.rateLimit.consume('register', requestMetadata(request).ipPrefix ?? 'unknown', input.email, 3, 3600);
    return this.auth.register(input, requestMetadata(request));
  }

  @Post('verify-email')
  @Public()
  verifyEmail(@Body() body: unknown) {
    return this.auth.verifyEmail(parse(tokenSchema, body).token);
  }

  @Post('login')
  @Public()
  async login(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<PublicSession> {
    const input = parse(loginRequestSchema, body);
    await this.rateLimit.consume('login', requestMetadata(request).ipPrefix ?? 'unknown', input.email.trim().toLowerCase(), 5, 60);
    const result = await this.auth.login(input, requestMetadata(request));
    response.cookie(this.config.cookieName, result.rawToken, {
      httpOnly: true, secure: this.config.production, sameSite: 'lax', path: '/', expires: result.expiresAt,
    });
    return result.session;
  }

  @Post('logout')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<{ loggedOut: true }> {
    const rawToken = readCookie(request.headers.cookie, this.config.cookieName);
    if (rawToken) {
      const principal = await this.sessions.resolve(rawToken);
      if (principal) await this.sessions.revoke(principal.sessionId);
    }
    response.clearCookie(this.config.cookieName, { httpOnly: true, secure: this.config.production, sameSite: 'lax', path: '/' });
    return { loggedOut: true };
  }

  @Get('session')
  async session(@Req() request: Request): Promise<PublicSession> {
    const rawToken = readCookie(request.headers.cookie, this.config.cookieName);
    if (!rawToken) throw new UnauthorizedException('Authentication required');
    const principal = await this.sessions.resolve(rawToken);
    if (!principal) throw new UnauthorizedException('Authentication required');
    return {
      userId: principal.userId, email: principal.email, name: principal.name, platformRole: principal.platformRole,
      tenantId: principal.tenantId, membershipRole: principal.membershipRole,
    };
  }

  @Post('forgot-password')
  @Public()
  async forgotPassword(@Body() body: unknown, @Req() request: Request) {
    const input = parse(forgotSchema, body);
    await this.rateLimit.consume('forgot-password', requestMetadata(request).ipPrefix ?? 'unknown', input.email.trim().toLowerCase(), 5, 3600);
    return this.auth.requestPasswordReset(input.email);
  }

  @Post('reset-password')
  @Public()
  async resetPassword(@Body() body: unknown, @Req() request: Request) {
    const input = parse(resetSchema, body);
    await this.rateLimit.consume('reset-password', requestMetadata(request).ipPrefix ?? 'unknown', input.token, 5, 3600);
    return this.auth.resetPassword(input.token, input.password);
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('Invalid authentication request');
  return result.data;
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

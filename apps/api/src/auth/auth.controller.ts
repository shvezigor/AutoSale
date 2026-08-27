import { loginRequestSchema, registerRequestSchema, type PublicSession } from '@autosale/contracts/auth';
import { BadRequestException, Body, Controller, Get, Inject, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { AuthService } from './auth.service.js';
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
  ) {}

  @Post('register')
  register(@Body() body: unknown, @Req() request: Request) {
    return this.auth.register(parse(registerRequestSchema, body), requestMetadata(request));
  }

  @Post('verify-email')
  verifyEmail(@Body() body: unknown) {
    return this.auth.verifyEmail(parse(tokenSchema, body).token);
  }

  @Post('login')
  async login(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<PublicSession> {
    const result = await this.auth.login(parse(loginRequestSchema, body), requestMetadata(request));
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
  async session(@Req() request: Request): Promise<Omit<PublicSession, 'name'>> {
    const rawToken = readCookie(request.headers.cookie, this.config.cookieName);
    if (!rawToken) throw new UnauthorizedException('Authentication required');
    const principal = await this.sessions.resolve(rawToken);
    if (!principal) throw new UnauthorizedException('Authentication required');
    return {
      userId: principal.userId, email: principal.email, platformRole: principal.platformRole,
      tenantId: principal.tenantId, membershipRole: principal.membershipRole,
    };
  }

  @Post('forgot-password')
  forgotPassword(@Body() body: unknown) {
    return this.auth.requestPasswordReset(parse(forgotSchema, body).email);
  }

  @Post('reset-password')
  resetPassword(@Body() body: unknown) {
    const input = parse(resetSchema, body);
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

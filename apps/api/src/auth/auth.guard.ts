import type { AuthPrincipal } from '@autosale/contracts/auth';
import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AUTH_HTTP_CONFIG, type AuthHttpConfig } from './auth.controller.js';
import { AUTH_ACCESS_KEY, SKIP_CSRF_KEY, type AccessRequirement } from './auth.decorators.js';
import { SessionService } from './session.service.js';
import { CsrfService } from './csrf.service.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AUTH_HTTP_CONFIG) private readonly config: AuthHttpConfig,
    @Inject(CsrfService) private readonly csrf: CsrfService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<AccessRequirement>(AUTH_ACCESS_KEY, [context.getHandler(), context.getClass()]) ?? 'AUTHENTICATED';
    if (requirement === 'PUBLIC') return true;
    const request = context.switchToHttp().getRequest<Request & { principal?: AuthPrincipal }>();
    const rawToken = readCookie(request.headers.cookie, this.config.cookieName);
    const principal = rawToken ? await this.sessions.resolve(rawToken) : null;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (!decideAccess(principal, requirement)) throw new ForbiddenException('Insufficient access');
    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [context.getHandler(), context.getClass()]) ?? false;
    if (!skipCsrf && !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) {
      const header = request.headers['x-csrf-token'];
      const supplied = Array.isArray(header) ? header[0] : header;
      if (!supplied || !this.csrf.verify(principal.sessionId, supplied)) {
        throw new ForbiddenException('Invalid CSRF token');
      }
    }
    request.principal = principal;
    return true;
  }
}

export function decideAccess(principal: AuthPrincipal | null, requirement: AccessRequirement): boolean {
  if (requirement === 'PUBLIC') return true;
  if (!principal) return false;
  if (requirement === 'AUTHENTICATED') return true;
  if (requirement === 'PLATFORM_ADMIN') return principal.platformRole === 'PLATFORM_ADMIN';
  if (principal.platformRole === 'PLATFORM_ADMIN' || !principal.tenantId) return false;
  if (requirement === 'TENANT_OWNER') return principal.membershipRole === 'OWNER';
  return principal.membershipRole === 'OWNER' || principal.membershipRole === 'MANAGER';
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

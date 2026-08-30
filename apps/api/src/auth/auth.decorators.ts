import type { AuthPrincipal } from '@autosale/contracts/auth';
import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';

export type AccessRequirement = 'PUBLIC' | 'AUTHENTICATED' | 'TENANT_MANAGER' | 'TENANT_OWNER' | 'PLATFORM_ADMIN';
export const AUTH_ACCESS_KEY = 'autosale:auth-access';
export const SKIP_CSRF_KEY = 'autosale:skip-csrf';

export const Public = () => SetMetadata(AUTH_ACCESS_KEY, 'PUBLIC' satisfies AccessRequirement);
export const RequirePlatformAdmin = () => SetMetadata(AUTH_ACCESS_KEY, 'PLATFORM_ADMIN' satisfies AccessRequirement);
export const RequireMembership = (role: 'OWNER' | 'MANAGER') =>
  SetMetadata(AUTH_ACCESS_KEY, role === 'OWNER' ? 'TENANT_OWNER' : 'TENANT_MANAGER' satisfies AccessRequirement);
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): AuthPrincipal =>
  context.switchToHttp().getRequest<{ principal: AuthPrincipal }>().principal,
);

import { randomUUID } from 'node:crypto';

import type { AuthPrincipal } from '@autosale/contracts/auth';
import type { PrismaClient } from '@autosale/database';

import type { IssuedSession, SessionMetadata } from './auth.types.js';
import { CryptoService } from './crypto.service.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export class SessionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly crypto: CryptoService,
    private readonly pepper: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(userId: string, tenantId: string | null, metadata: SessionMetadata): Promise<IssuedSession> {
    const token = this.crypto.issueOpaqueToken(this.pepper);
    const expiresAt = new Date(this.now().getTime() + SESSION_TTL_MS);
    const sessionId = randomUUID();
    const issued = await this.prisma.$queryRaw<Array<{ session_id: string }>>`
      SELECT session_id FROM public.api_issue_session(
        ${sessionId}::uuid,
        ${userId}::uuid,
        ${tenantId}::uuid,
        ${token.hash},
        ${expiresAt},
        ${metadata.ipPrefix?.slice(0, 64) ?? null},
        ${metadata.userAgent?.slice(0, 256) ?? null}
      )
    `;
    if (!issued[0]) throw new Error('Unable to issue session');
    return { sessionId: issued[0].session_id, rawToken: token.raw, tokenHash: token.hash, expiresAt };
  }

  async resolve(rawToken: string): Promise<AuthPrincipal | null> {
    const tokenHash = this.crypto.hashOpaqueToken(rawToken, this.pepper);
    const rows = await this.prisma.$queryRaw<SessionAuthorityRow[]>`
      SELECT * FROM public.api_resolve_session(${tokenHash}, ${this.now()})
    `;
    const session = rows[0];
    if (!session) return null;

    return {
      userId: session.user_id,
      email: session.email,
      name: session.display_name,
      platformRole: session.platform_role,
      tenantId: session.tenant_id,
      membershipRole: session.membership_role,
      locale: session.locale === 'en' ? 'en' : 'uk',
      avatarUrl: session.avatar_storage_key
        ? `/api/media/profile/avatar?v=${encodeURIComponent(session.avatar_checksum ?? '1')}`
        : null,
      sessionId: session.session_id,
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.$queryRaw`
      SELECT revoked_count FROM public.api_revoke_session(${sessionId}::uuid, ${this.now()})
    `;
  }

  async revokeAllForUser(userId: string): Promise<number> {
    return this.revokeMatching(userId, null, null);
  }

  async revokeOthersForUser(userId: string, currentSessionId: string): Promise<number> {
    return this.revokeMatching(userId, currentSessionId, null);
  }

  private async revokeMatching(userId: string | null, exceptSessionId: string | null, tenantId: string | null): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ revoked_count: number }>>`
      SELECT revoked_count FROM public.api_revoke_sessions(
        ${userId}::uuid, ${exceptSessionId}::uuid, ${tenantId}::uuid, ${this.now()}
      )
    `;
    return rows[0]?.revoked_count ?? 0;
  }
}

type SessionAuthorityRow = {
  session_id: string;
  user_id: string;
  tenant_id: string | null;
  email: string;
  display_name: string;
  platform_role: 'USER' | 'PLATFORM_ADMIN';
  membership_role: 'OWNER' | 'MANAGER' | null;
  locale: string;
  avatar_storage_key: string | null;
  avatar_checksum: string | null;
};

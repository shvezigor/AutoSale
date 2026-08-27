import type { AuthPrincipal } from '@autosale/contracts/auth';
import type { PrismaClient } from '@autosale/database';

import type { IssuedSession, SessionMetadata } from './auth.types.js';
import { CryptoService } from './crypto.service.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const LAST_SEEN_WRITE_INTERVAL_MS = 15 * 60 * 1_000;

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
    const session = await this.prisma.session.create({
      data: {
        userId,
        tenantId,
        tokenHash: token.hash,
        expiresAt,
        ipPrefix: metadata.ipPrefix?.slice(0, 64) ?? null,
        userAgent: metadata.userAgent?.slice(0, 256) ?? null,
      },
    });
    return { sessionId: session.id, rawToken: token.raw, tokenHash: token.hash, expiresAt };
  }

  async resolve(rawToken: string): Promise<AuthPrincipal | null> {
    const tokenHash = this.crypto.hashOpaqueToken(rawToken, this.pepper);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { tenant: { select: { status: true } }, user: { include: { memberships: true } } },
    });
    const now = this.now();
    if (!session || session.revokedAt || session.expiresAt <= now || session.user.status !== 'ACTIVE') {
      return null;
    }
    if (session.tenantId && session.tenant?.status !== 'ACTIVE') return null;

    const membership = session.tenantId
      ? session.user.memberships.find((item) => item.tenantId === session.tenantId)
      : undefined;
    if (session.tenantId && (!membership || membership.status !== 'ACTIVE')) {
      return null;
    }

    if (now.getTime() - session.lastSeenAt.getTime() >= LAST_SEEN_WRITE_INTERVAL_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    }

    return {
      userId: session.userId,
      email: session.user.email,
      platformRole: session.user.platformRole,
      tenantId: session.tenantId,
      membershipRole: membership?.role ?? null,
      sessionId: session.id,
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.update({ where: { id: sessionId }, data: { revokedAt: this.now() } });
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.now() },
    });
    return result.count;
  }
}

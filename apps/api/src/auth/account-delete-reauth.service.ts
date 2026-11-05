import type { AuthPrincipal } from '@autosale/contracts/auth';
import { setTenantContext, type Prisma, type PrismaClient } from '@autosale/database';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';

import { CryptoService } from './crypto.service.js';
import { RateLimitService } from './rate-limit.service.js';

const PURPOSE = 'ACCOUNT_DELETE';
const LOCAL_PASSWORD = 'LOCAL_PASSWORD';
const PROOF_TTL_MS = 5 * 60 * 1_000;
const PROOF_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const INVALID = 'ACCOUNT_DELETE_REAUTH_INVALID';

type LockedAuthority = { password_hash: string | null };

/** Internal foundation only. No HTTP route may expose this until deletion is safe. */
export class AccountDeleteReauthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly crypto: CryptoService,
    private readonly rateLimit: RateLimitService,
    private readonly tokenPepper: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issueLocalPasswordProof(
    principal: AuthPrincipal,
    currentPassword: string,
    ipPrefix: string,
  ): Promise<{ proof: string; expiresAt: Date }> {
    await this.rateLimit.consume('account-delete-reauth', ipPrefix, principal.email, 5, 15 * 60);
    if (!principal.tenantId || !currentPassword) throw new UnauthorizedException(INVALID);

    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId }, select: { status: true, passwordHash: true },
    });
    if (user?.status !== 'ACTIVE') throw new UnauthorizedException(INVALID);
    if (!user.passwordHash) throw new BadRequestException('ACCOUNT_DELETE_LOCAL_PASSWORD_UNAVAILABLE');

    let passwordValid = false;
    try {
      passwordValid = await this.crypto.verifyPassword(user.passwordHash, currentPassword);
    } catch {
      // Treat a corrupted hash and an incorrect password identically.
    }
    if (!passwordValid) throw new UnauthorizedException(INVALID);

    const token = this.crypto.issueOpaqueToken(this.tokenPepper);
    const expiresAt = await this.prisma.$transaction(async (tx) => {
      const authority = await this.lockedAuthority(tx, principal);
      if (!authority?.password_hash || authority.password_hash !== user.passwordHash) {
        throw new UnauthorizedException(INVALID);
      }
      const proofExpiresAt = new Date(this.now().getTime() + PROOF_TTL_MS);
      await tx.accountReauthProof.create({ data: {
        userId: principal.userId, sessionId: principal.sessionId, tenantId: principal.tenantId!,
        purpose: PURPOSE, method: LOCAL_PASSWORD, tokenHash: token.hash,
        credentialFingerprint: this.crypto.hashOpaqueToken(authority.password_hash, this.tokenPepper),
        expiresAt: proofExpiresAt,
      } });
      return proofExpiresAt;
    });
    return { proof: token.raw, expiresAt };
  }

  /** Call only after external intent is durable, inside the DB transition/revocation transaction. */
  async consumeInTransaction(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    proof: string,
  ): Promise<void> {
    if (!principal.tenantId || !PROOF_FORMAT.test(proof)) throw new UnauthorizedException(INVALID);
    const authority = await this.lockedAuthority(tx, principal);
    if (!authority?.password_hash) throw new UnauthorizedException(INVALID);
    const now = this.now();

    const tokenHash = this.crypto.hashOpaqueToken(proof, this.tokenPepper);
    const existing = await tx.accountReauthProof.findUnique({ where: { tokenHash } });
    if (
      !existing || existing.userId !== principal.userId || existing.sessionId !== principal.sessionId
      || existing.tenantId !== principal.tenantId || existing.purpose !== PURPOSE
      || existing.method !== LOCAL_PASSWORD || existing.usedAt !== null || existing.expiresAt <= now
      || existing.credentialFingerprint !== this.crypto.hashOpaqueToken(authority.password_hash, this.tokenPepper)
    ) throw new UnauthorizedException(INVALID);

    const consumed = await tx.accountReauthProof.updateMany({
      where: { id: existing.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) throw new UnauthorizedException(INVALID);
  }

  private async lockedAuthority(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
  ): Promise<LockedAuthority | null> {
    if (!principal.tenantId) return null;
    await setTenantContext(tx, principal.tenantId);
    const rows = await tx.$queryRaw<LockedAuthority[]>`
      SELECT app_user.password_hash
      FROM public.users AS app_user
      JOIN public.sessions AS session ON session.user_id = app_user.id
      JOIN public.tenants AS tenant ON tenant.id = session.tenant_id
      JOIN public.tenant_memberships AS membership
        ON membership.user_id = app_user.id AND membership.tenant_id = tenant.id
      WHERE app_user.id = ${principal.userId}::uuid
        AND session.id = ${principal.sessionId}::uuid
        AND session.tenant_id = ${principal.tenantId}::uuid
        AND session.revoked_at IS NULL AND session.expires_at > clock_timestamp()
        AND app_user.status::text = 'ACTIVE'
        AND tenant.status::text = 'ACTIVE'
        AND tenant.created_by_user_id = app_user.id
        AND membership.role::text = 'OWNER' AND membership.status::text = 'ACTIVE'
      FOR UPDATE OF app_user, session, tenant, membership
    `;
    return rows[0] ?? null;
  }
}

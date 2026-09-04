import { createHash, randomBytes } from 'node:crypto';

import type { PublicSession } from '@autosale/contracts/auth';
import type { PrismaClient } from '@autosale/database';
import type { GoogleSignInClientPort, GoogleSignInIdentity } from '@autosale/integrations';
import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

import type { SessionMetadata } from './auth.types.js';
import { GoogleSignInStateService } from './google-sign-in-state.service.js';
import { SessionService } from './session.service.js';

const UNAVAILABLE = 'Google Sign-In is unavailable';
const CANCELLED = 'Google Sign-In was cancelled';
const FAILED = 'Unable to complete Google Sign-In';

type SessionResult = { session: PublicSession; rawToken: string; expiresAt: Date };

export type GoogleCallbackResult =
  | { kind: 'SESSION'; sessionResult: SessionResult; returnPath: string }
  | { kind: 'ONBOARDING'; grant: string; expiresAt: Date };

export class GoogleSignInService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: GoogleSignInClientPort,
    private readonly state: GoogleSignInStateService,
    private readonly sessions: SessionService,
    private readonly enabled: boolean,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async start(returnPath?: string): Promise<{ authorizationUrl: string }> {
    this.assertEnabled();
    const attempt = await this.state.createAttempt(returnPath);
    return { authorizationUrl: this.provider.getAuthorizationUrl(attempt) };
  }

  async completeCallback(
    input: { state: string; code?: string; denied?: boolean },
    metadata: SessionMetadata,
  ): Promise<GoogleCallbackResult> {
    this.assertEnabled();
    const attempt = await this.state.consumeState(input.state);
    if (input.denied) throw new UnauthorizedException(CANCELLED);
    if (!input.code) throw new BadRequestException(FAILED);

    let identity: GoogleSignInIdentity;
    try {
      identity = await this.provider.exchangeAndVerify(input.code);
    } catch {
      throw new UnauthorizedException(FAILED);
    }
    identity = { ...identity, email: identity.email.trim().toLowerCase(), name: identity.name.trim() };

    const linked = await this.prisma.googleIdentity.findUnique({
      where: { googleSubject: identity.subject },
      include: { user: { include: { memberships: true } } },
    });
    if (linked) {
      if (linked.user.status !== 'ACTIVE') throw new UnauthorizedException(FAILED);
      await this.prisma.googleIdentity.update({ where: { googleSubject: identity.subject }, data: { lastUsedAt: this.now() } });
      return {
        kind: 'SESSION', returnPath: attempt.returnPath,
        sessionResult: await this.createSessionResult(linked.user, metadata),
      };
    }

    const matchingUser = await this.prisma.user.findUnique({ where: { email: identity.email }, include: { memberships: true } });
    if (matchingUser) {
      if (matchingUser.status !== 'ACTIVE' || !matchingUser.emailVerifiedAt) throw new UnauthorizedException(FAILED);
      try {
        await this.prisma.$transaction(async (transaction) => {
          await transaction.googleIdentity.create({ data: {
            userId: matchingUser.id, googleSubject: identity.subject, emailAtLink: identity.email, lastUsedAt: this.now(),
          } });
          await transaction.securityAuditLog.create({ data: {
            userId: matchingUser.id, tenantId: activeMembership(matchingUser)?.tenantId ?? null,
            actor: 'SYSTEM', action: 'GOOGLE_IDENTITY_AUTO_LINKED', result: 'SUCCESS',
            metadata: { subjectHash: hash(identity.subject), emailHash: hash(identity.email) },
          } });
        });
      } catch {
        throw new UnauthorizedException(FAILED);
      }
      return {
        kind: 'SESSION', returnPath: attempt.returnPath,
        sessionResult: await this.createSessionResult(matchingUser, metadata),
      };
    }

    const onboarding = await this.state.armOnboarding(attempt.attemptId, identity);
    return { kind: 'ONBOARDING', ...onboarding };
  }

  async onboardingSummary(grant: string): Promise<{ email: string; name: string }> {
    this.assertEnabled();
    return this.state.readOnboarding(grant);
  }

  async completeOnboarding(
    input: { grant: string; tenantName: string },
    metadata: SessionMetadata,
  ): Promise<{ sessionResult: SessionResult; returnPath: string }> {
    this.assertEnabled();
    const pending = await this.state.consumeOnboarding(input.grant);
    const tenantName = input.tenantName.trim();
    if (!tenantName) throw new BadRequestException('Workspace name is required');

    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        const tenant = await transaction.tenant.create({ data: {
          key: `${slug(tenantName)}-${randomBytes(4).toString('hex')}`, name: tenantName, status: 'ACTIVE',
        } });
        const user = await transaction.user.create({ data: {
          email: pending.email.trim().toLowerCase(), name: pending.name, passwordHash: null,
          emailVerifiedAt: this.now(), status: 'ACTIVE',
        } });
        const membership = await transaction.tenantMembership.create({ data: {
          userId: user.id, tenantId: tenant.id, role: 'OWNER', status: 'ACTIVE',
        } });
        await transaction.googleIdentity.create({ data: {
          userId: user.id, googleSubject: pending.subject, emailAtLink: pending.email.trim().toLowerCase(), lastUsedAt: this.now(),
        } });
        await transaction.securityAuditLog.create({ data: {
          userId: user.id, tenantId: tenant.id, actor: 'SYSTEM', action: 'GOOGLE_ACCOUNT_CREATED', result: 'SUCCESS',
          metadata: { subjectHash: hash(pending.subject), emailHash: hash(pending.email) },
        } });
        return { user, membership };
      });
      return {
        returnPath: pending.returnPath,
        sessionResult: await this.createSessionResult({ ...created.user, memberships: [created.membership] }, metadata),
      };
    } catch {
      throw new UnauthorizedException(FAILED);
    }
  }

  private assertEnabled(): void {
    if (!this.enabled) throw new ServiceUnavailableException(UNAVAILABLE);
  }

  private async createSessionResult(user: SessionUser, metadata: SessionMetadata): Promise<SessionResult> {
    const membership = activeMembership(user);
    const issued = await this.sessions.create(user.id, membership?.tenantId ?? null, metadata);
    return {
      rawToken: issued.rawToken, expiresAt: issued.expiresAt,
      session: {
        userId: user.id, email: user.email, name: user.name, platformRole: user.platformRole,
        tenantId: membership?.tenantId ?? null, membershipRole: membership?.role ?? null,
      },
    };
  }
}

type SessionUser = {
  id: string;
  email: string;
  name: string;
  platformRole: 'USER' | 'PLATFORM_ADMIN';
  memberships: Array<{ tenantId: string; role: 'OWNER' | 'MANAGER'; status: string }>;
};

function activeMembership(user: SessionUser) {
  return user.memberships.find((membership) => membership.status === 'ACTIVE') ?? null;
}

function hash(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function slug(value: string): string {
  return value.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'tenant';
}

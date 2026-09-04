import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { PrismaClient } from '@autosale/database';

const STATE_TTL_MS = 10 * 60 * 1000;
const ONBOARDING_TTL_MS = 15 * 60 * 1000;
const DEFAULT_RETURN_PATH = '/conversations';
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;
const BLOCKED_RETURN_PATHS = new Set(['/login', '/register', '/onboarding/google']);
const INVALID_STATE = 'Invalid or expired Google Sign-In state';
const INVALID_ONBOARDING = 'Invalid or expired Google onboarding';

export type GooglePendingIdentityInput = {
  subject: string;
  email: string;
  name: string;
};

export type PendingGoogleIdentity = GooglePendingIdentityInput & {
  attemptId: string;
  returnPath: string;
};

export class GoogleSignInStateService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createAttempt(returnPath?: string): Promise<{ state: string }> {
    const state = issueToken();
    const createdAt = this.now();
    await this.prisma.googleSignInAttempt.create({ data: {
      id: randomUUID(),
      stateTokenHash: hashToken(state),
      returnPath: normalizeReturnPath(returnPath),
      stateExpiresAt: new Date(createdAt.getTime() + STATE_TTL_MS),
    } });
    return { state };
  }

  async consumeState(state: string): Promise<{ attemptId: string; returnPath: string }> {
    const consumed = await this.prisma.googleSignInAttempt.updateManyAndReturn({
      where: { stateTokenHash: hashToken(state), stateUsedAt: null, stateExpiresAt: { gt: this.now() } },
      data: { stateUsedAt: this.now() },
      select: { id: true, returnPath: true },
    });
    const attempt = consumed[0];
    if (!attempt) throw new Error(INVALID_STATE);
    return { attemptId: attempt.id, returnPath: attempt.returnPath };
  }

  async armOnboarding(attemptId: string, identity: GooglePendingIdentityInput): Promise<{ grant: string; expiresAt: Date }> {
    const grant = issueToken();
    const expiresAt = new Date(this.now().getTime() + ONBOARDING_TTL_MS);
    const armed = await this.prisma.googleSignInAttempt.updateMany({
      where: { id: attemptId, stateUsedAt: { not: null }, onboardingTokenHash: null },
      data: {
        onboardingTokenHash: hashToken(grant), onboardingExpiresAt: expiresAt,
        googleSubject: identity.subject, verifiedEmail: identity.email, displayName: identity.name,
      },
    });
    if (armed.count !== 1) throw new Error(INVALID_ONBOARDING);
    return { grant, expiresAt };
  }

  async readOnboarding(grant: string): Promise<{ email: string; name: string }> {
    const attempt = await this.prisma.googleSignInAttempt.findFirst({
      where: {
        onboardingTokenHash: hashToken(grant), onboardingUsedAt: null,
        onboardingExpiresAt: { gt: this.now() }, googleSubject: { not: null },
        verifiedEmail: { not: null }, displayName: { not: null },
      },
      select: { verifiedEmail: true, displayName: true },
    });
    if (!attempt?.verifiedEmail || !attempt.displayName) throw new Error(INVALID_ONBOARDING);
    return { email: attempt.verifiedEmail, name: attempt.displayName };
  }

  async consumeOnboarding(grant: string): Promise<PendingGoogleIdentity> {
    return this.prisma.$transaction(async (transaction) => {
      const attempt = await transaction.googleSignInAttempt.findFirst({
        where: {
          onboardingTokenHash: hashToken(grant), onboardingUsedAt: null,
          onboardingExpiresAt: { gt: this.now() }, googleSubject: { not: null },
          verifiedEmail: { not: null }, displayName: { not: null },
        },
        select: {
          id: true, returnPath: true, googleSubject: true, verifiedEmail: true, displayName: true,
        },
      });
      if (!attempt?.googleSubject || !attempt.verifiedEmail || !attempt.displayName) throw new Error(INVALID_ONBOARDING);

      const consumed = await transaction.googleSignInAttempt.updateMany({
        where: { id: attempt.id, onboardingTokenHash: hashToken(grant), onboardingUsedAt: null },
        data: {
          onboardingUsedAt: this.now(), onboardingTokenHash: null, googleSubject: null,
          verifiedEmail: null, displayName: null,
        },
      });
      if (consumed.count !== 1) throw new Error(INVALID_ONBOARDING);
      return {
        attemptId: attempt.id, returnPath: attempt.returnPath, subject: attempt.googleSubject,
        email: attempt.verifiedEmail, name: attempt.displayName,
      };
    });
  }
}

function issueToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeReturnPath(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || CONTROL_CHARACTER_PATTERN.test(value)) {
    return DEFAULT_RETURN_PATH;
  }
  let pathname: string;
  try {
    pathname = new URL(value, 'https://autosale.local').pathname;
  } catch {
    return DEFAULT_RETURN_PATH;
  }
  if (BLOCKED_RETURN_PATHS.has(pathname) || pathname.startsWith('/api/auth/google')) return DEFAULT_RETURN_PATH;
  return value;
}

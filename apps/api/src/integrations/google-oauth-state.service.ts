import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { type PrismaClient, withTenantTransaction } from '@autosale/database';

const STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_RETURN_PATH = '/settings';
const INVALID_STATE_ERROR = 'Invalid or expired Google OAuth state';
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

export type CreateGoogleOAuthAttemptInput = {
  tenantId: string;
  userId: string;
  returnPath?: string;
};

export type ConsumedGoogleOAuthAttempt = {
  id: string;
  tenantId: string;
  userId: string;
  returnPath: string;
};

const hashState = (state: string): string => createHash('sha256').update(state).digest('hex');

const normalizeReturnPath = (returnPath: string | undefined): string => {
  if (!returnPath || !returnPath.startsWith('/') || returnPath.startsWith('//') || returnPath.includes('\\') || CONTROL_CHARACTER_PATTERN.test(returnPath)) {
    return DEFAULT_RETURN_PATH;
  }
  return returnPath;
};

export class GoogleOAuthStateService {
  constructor(private readonly prisma: PrismaClient) {}

  async createAttempt(input: CreateGoogleOAuthAttemptInput): Promise<{ state: string }> {
    const state = randomBytes(32).toString('base64url');
    const now = new Date();

    await withTenantTransaction(this.prisma, input.tenantId, async (transaction) => {
      await transaction.googleOAuthAttempt.updateMany({
        where: { tenantId: input.tenantId, usedAt: null },
        data: { usedAt: now },
      });
      await transaction.googleOAuthAttempt.create({
        data: {
          id: randomUUID(),
          tokenHash: hashState(state),
          tenantId: input.tenantId,
          userId: input.userId,
          returnPath: normalizeReturnPath(input.returnPath),
          expiresAt: new Date(now.getTime() + STATE_TTL_MS),
          usedAt: null,
        },
      });
    });

    return { state };
  }

  async consumeAttempt(state: string): Promise<ConsumedGoogleOAuthAttempt> {
    try {
      const consumedAt = new Date();
      const authority = await this.prisma.$queryRaw<Array<{ tenant_id: string; attempt_id: string }>>`
        SELECT tenant_id, attempt_id
        FROM public.api_consume_google_oauth_attempt(${hashState(state)}, ${consumedAt})
      `;
      const consumed = authority[0];
      if (!consumed) throw new Error(INVALID_STATE_ERROR);
      const attempt = await withTenantTransaction(this.prisma, consumed.tenant_id, (transaction) =>
        transaction.googleOAuthAttempt.findUnique({
          where: { id: consumed.attempt_id },
          select: { id: true, tenantId: true, userId: true, returnPath: true },
        }));
      if (!attempt) throw new Error(INVALID_STATE_ERROR);
      return attempt;
    } catch {
      throw new Error(INVALID_STATE_ERROR);
    }
  }
}

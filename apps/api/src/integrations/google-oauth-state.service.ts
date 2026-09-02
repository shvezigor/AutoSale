import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { PrismaClient } from '@autosale/database';

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

    await this.prisma.$transaction(async (transaction) => {
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
      const attempts = await this.prisma.googleOAuthAttempt.updateManyAndReturn({
        where: { tokenHash: hashState(state), usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
        select: { id: true, tenantId: true, userId: true, returnPath: true },
      });
      const attempt = attempts[0];
      if (!attempt) throw new Error(INVALID_STATE_ERROR);
      return attempt;
    } catch {
      throw new Error(INVALID_STATE_ERROR);
    }
  }
}

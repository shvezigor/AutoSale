import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@autosale/database';

const STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_RETURN_PATH = '/settings';
const INVALID_STATE_ERROR = 'Invalid or expired OAuth state';
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

type CreateInstagramOAuthStateInput = {
  tenantId: string;
  userId: string;
  returnPath?: string;
};

type ConsumedInstagramOAuthState = {
  tenantId: string;
  userId: string;
  returnPath: string;
};

function hashState(rawState: string): string {
  return createHash('sha256').update(rawState).digest('hex');
}

function normalizeReturnPath(returnPath: string | undefined): string {
  if (
    returnPath === undefined ||
    !returnPath.startsWith('/') ||
    returnPath.startsWith('//') ||
    returnPath.includes('\\') ||
    CONTROL_CHARACTER_PATTERN.test(returnPath)
  ) {
    return DEFAULT_RETURN_PATH;
  }

  return returnPath;
}

export class InstagramOAuthStateService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateInstagramOAuthStateInput): Promise<string> {
    const rawState = randomBytes(32).toString('base64url');
    const now = new Date();

    await this.prisma.$transaction(async (transaction) => {
      await transaction.instagramOAuthState.updateMany({
        where: { tenantId: input.tenantId, usedAt: null },
        data: { usedAt: now },
      });
      await transaction.instagramOAuthState.create({
        data: {
          tokenHash: hashState(rawState),
          tenantId: input.tenantId,
          userId: input.userId,
          returnPath: normalizeReturnPath(input.returnPath),
          expiresAt: new Date(now.getTime() + STATE_TTL_MS),
        },
      });
    }, { isolationLevel: 'Serializable' });

    return rawState;
  }

  async consume(rawState: string): Promise<ConsumedInstagramOAuthState> {
    try {
      if (typeof rawState !== 'string') {
        throw new Error(INVALID_STATE_ERROR);
      }

      const states = await this.prisma.instagramOAuthState.updateManyAndReturn({
        where: {
          tokenHash: hashState(rawState),
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
        select: { tenantId: true, userId: true, returnPath: true },
      });

      const state = states[0];

      if (state === undefined) {
        throw new Error(INVALID_STATE_ERROR);
      }

      return state;
    } catch {
      throw new Error(INVALID_STATE_ERROR);
    }
  }
}

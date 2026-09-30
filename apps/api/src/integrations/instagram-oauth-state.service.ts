import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { type PrismaClient, withTenantTransaction } from '@autosale/database';

const STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_RETURN_PATH = '/settings';
const INVALID_STATE_ERROR = 'Invalid or expired OAuth state';
const CLEANUP_PENDING_ERROR = 'Instagram cleanup pending';
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

type CreateInstagramOAuthStateInput = {
  tenantId: string;
  userId: string;
  returnPath?: string;
};

type ConsumedInstagramOAuthState = {
  id: string;
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
    const stateId = randomUUID();
    const now = new Date();

    await this.withSerializableRetry(() => withTenantTransaction(this.prisma, input.tenantId, async (transaction) => {
      await transaction.tenant.update({
        where: { id: input.tenantId },
        data: { instagramOAuthCurrentAttemptId: stateId },
      });
      const cleanup = await transaction.instagramCredentialCleanup.findFirst({
        where: { tenantId: input.tenantId, terminalAt: null },
        select: { id: true },
      });
      if (cleanup) {
        throw new Error(CLEANUP_PENDING_ERROR);
      }
      await transaction.instagramOAuthState.updateMany({
        where: { tenantId: input.tenantId, usedAt: null },
        data: { usedAt: now },
      });
      await transaction.instagramOAuthState.create({
        data: {
          id: stateId,
          tokenHash: hashState(rawState),
          tenantId: input.tenantId,
          userId: input.userId,
          returnPath: normalizeReturnPath(input.returnPath),
          expiresAt: new Date(now.getTime() + STATE_TTL_MS),
        },
      });
      await transaction.securityAuditLog.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          actor: 'USER',
          action: 'INSTAGRAM_CONNECT_STARTED',
          result: 'SUCCESS',
          metadata: {},
        },
      });
    }, { isolationLevel: 'Serializable' }));

    return rawState;
  }

  async consume(rawState: string): Promise<ConsumedInstagramOAuthState> {
    try {
      if (typeof rawState !== 'string') {
        throw new Error(INVALID_STATE_ERROR);
      }

      const consumedAt = new Date();
      const authority = await this.prisma.$queryRaw<Array<{ tenant_id: string; state_id: string }>>`
        SELECT tenant_id, state_id
        FROM public.api_consume_instagram_oauth_state(${hashState(rawState)}, ${consumedAt})
      `;
      const consumed = authority[0];
      if (!consumed) throw new Error(INVALID_STATE_ERROR);

      const state = await withTenantTransaction(this.prisma, consumed.tenant_id, (transaction) =>
        transaction.instagramOAuthState.findUnique({
          where: { id: consumed.state_id },
          select: { id: true, tenantId: true, userId: true, returnPath: true },
        }));
      if (!state) throw new Error(INVALID_STATE_ERROR);
      return state;
    } catch {
      throw new Error(INVALID_STATE_ERROR);
    }
  }

  private async withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await operation(); } catch (error) {
        lastError = error;
        if (!isSerializableConflict(error) || attempt === 2) throw error;
      }
    }
    throw lastError;
  }
}

function isSerializableConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034';
}

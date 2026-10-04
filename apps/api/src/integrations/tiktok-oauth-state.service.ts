import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { type PrismaClient, withTenantTransaction } from '@autosale/database';

const STATE_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_RETURN_PATH = '/settings?tab=social';
const INVALID_STATE_ERROR = 'Invalid or expired TikTok OAuth state';
const CLEANUP_PENDING_ERROR = 'TikTok cleanup pending';
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

export type TikTokOAuthBinding = {
  id: string;
  tenantId: string;
  userId: string;
  returnPath: string;
};

const hashState = (state: string): string => createHash('sha256').update(state).digest('hex');

function normalizeReturnPath(returnPath: string | undefined): string {
  if (
    !returnPath ||
    !returnPath.startsWith('/') ||
    returnPath.startsWith('//') ||
    returnPath.includes('\\') ||
    CONTROL_CHARACTER_PATTERN.test(returnPath)
  ) {
    return DEFAULT_RETURN_PATH;
  }
  return returnPath;
}

export class TikTokOAuthStateService {
  constructor(private readonly prisma: PrismaClient) {}

  async issue(input: { tenantId: string; userId: string; returnPath?: string }): Promise<string> {
    const rawState = randomBytes(32).toString('base64url');
    const now = new Date();

    await withTenantTransaction(this.prisma, input.tenantId, async (transaction) => {
      const cleanup = await transaction.tikTokCredentialCleanup.findFirst({
        where: { tenantId: input.tenantId, terminalAt: null },
        select: { id: true },
      });
      if (cleanup) throw new Error(CLEANUP_PENDING_ERROR);

      await transaction.tikTokOAuthAttempt.updateMany({
        where: { tenantId: input.tenantId, usedAt: null },
        data: { usedAt: now },
      });
      await transaction.tikTokOAuthAttempt.create({
        data: {
          id: randomUUID(),
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
          action: 'TIKTOK_CONNECT_STARTED',
          result: 'SUCCESS',
          metadata: {},
        },
      });
    });

    return rawState;
  }

  async consume(rawState: string): Promise<TikTokOAuthBinding> {
    try {
      const consumedAt = new Date();
      const authority = await this.prisma.$queryRaw<Array<{ tenant_id: string; attempt_id: string }>>`
        SELECT tenant_id, attempt_id
        FROM public.api_consume_tiktok_oauth_attempt(${hashState(rawState)}, ${consumedAt})
      `;
      const consumed = authority[0];
      if (!consumed) throw new Error(INVALID_STATE_ERROR);
      const attempt = await withTenantTransaction(this.prisma, consumed.tenant_id, (transaction) =>
        transaction.tikTokOAuthAttempt.findUnique({
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

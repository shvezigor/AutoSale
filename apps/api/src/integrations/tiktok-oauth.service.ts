import { randomUUID } from 'node:crypto';

import type { TikTokCapabilities, TikTokConnectionSummary } from '@autosale/contracts/tiktok';
import { assertTenantAcceptingMutations, type Prisma, type PrismaClient, withTenantTransaction } from '@autosale/database';
import { TikTokBusinessMessagingError, type TikTokBusinessMessagingClient } from '@autosale/integrations';

import { CredentialCipher } from './credential-cipher.js';
import { TikTokOAuthStateService, type TikTokOAuthBinding } from './tiktok-oauth-state.service.js';

const CALLBACK_PATH = '/api/integrations/tiktok/callback/';
const CLEANUP_LEASE_MS = 5 * 60 * 1_000;
const SAFE_FAILURE_MESSAGE = 'TikTok connection failed';
const CLEANUP_FAILED_CODE = 'TIKTOK_DISCONNECT_CLEANUP_FAILED';

const SAFE_CONNECTION_SELECT = {
  externalAccountId: true,
  displayName: true,
  status: true,
  capabilities: true,
  tokenExpiresAt: true,
  lastVerifiedAt: true,
  lastErrorCode: true,
} as const;

type SafeConnectionRow = {
  externalAccountId: string;
  displayName: string | null;
  status: 'ACTIVE' | 'INBOUND_ONLY' | 'REAUTH_REQUIRED' | 'ERROR' | 'DISCONNECTED';
  capabilities: Prisma.JsonValue | null;
  tokenExpiresAt: Date | null;
  lastVerifiedAt: Date | null;
  lastErrorCode: string | null;
};

export interface TikTokAppWebhookHealth {
  assertHealthy(): Promise<void>;
}

export type TikTokCallbackResult = {
  returnPath: string;
  summary: TikTokConnectionSummary;
};

export class TikTokOAuthService {
  private readonly callbackUri: string;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly client: TikTokBusinessMessagingClient,
    private readonly states: TikTokOAuthStateService,
    private readonly cipher: CredentialCipher,
    private readonly appWebhookHealth: TikTokAppWebhookHealth,
    appPublicUrl: string,
    private readonly enabled: boolean,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.callbackUri = new URL(CALLBACK_PATH, ensureTrailingSlash(appPublicUrl)).toString();
  }

  async getSummary(tenantId: string): Promise<TikTokConnectionSummary> {
    const [connection, cleanup] = await Promise.all([
      withTenantTransaction(this.prisma, tenantId, (transaction) => transaction.tikTokConnection.findUnique({
        where: { tenantId },
        select: SAFE_CONNECTION_SELECT,
      })),
      this.getCleanupStatus(tenantId),
    ]);
    if (!connection) return emptySummary(cleanup);

    const expired = (connection.status === 'ACTIVE' || connection.status === 'INBOUND_ONLY') &&
      connection.tokenExpiresAt !== null && connection.tokenExpiresAt <= this.now();
    if (expired) {
      await withTenantTransaction(this.prisma, tenantId, (transaction) => transaction.tikTokConnection.updateMany({
        where: { tenantId, tokenExpiresAt: { lte: this.now() } },
        data: { status: 'REAUTH_REQUIRED', lastErrorCode: 'TIKTOK_TOKEN_EXPIRED' },
      })).catch(() => undefined);
    }
    return toSummary(connection, cleanup, expired);
  }

  async authorize(tenantId: string, userId: string, returnPath?: string): Promise<{ authorizationUrl: string }> {
    this.assertEnabled();
    await withTenantTransaction(this.prisma, tenantId, (transaction) =>
      assertTenantAcceptingMutations(transaction, tenantId, 'META_INBOUND'));
    const state = await this.states.issue({ tenantId, userId, ...(returnPath === undefined ? {} : { returnPath }) });
    return { authorizationUrl: this.client.getAuthorizationUrl({ state }) };
  }

  async completeCallback(code: string | undefined, rawState: string): Promise<TikTokCallbackResult> {
    this.assertEnabled();
    let binding: TikTokOAuthBinding;
    try {
      binding = await this.states.consume(rawState);
    } catch {
      throw safeFailure();
    }

    if (!await this.hasActiveOwner(binding.tenantId, binding.userId) || !code) {
      await this.auditBestEffort(binding, 'TIKTOK_CALLBACK_FAILED', 'TIKTOK_CALLBACK_INVALID');
      throw safeFailure();
    }

    let issuedAccessToken: string | null = null;
    try {
      const token = await this.client.exchangeCode({ code, redirectUri: this.callbackUri });
      issuedAccessToken = token.accessToken;
      const capabilities = await this.client.getCapabilities(token.accessToken, token.accountId);
      if (!capabilities.receiveMessages) throw new Error('TIKTOK_REQUIRED_SCOPES_MISSING');
      const account = await this.client.getAccount(token.accessToken, token.accountId);
      if (account.accountId !== token.accountId) throw new Error('TIKTOK_ACCOUNT_IDENTITY_MISMATCH');

      const owningTenant = await this.resolveAccountTenant(account.accountId);
      if (owningTenant && owningTenant !== binding.tenantId) throw new Error('TIKTOK_ACCOUNT_ALREADY_CONNECTED');
      await this.assertNoConnectedCredentials(binding.tenantId);
      await this.appWebhookHealth.assertHealthy();

      const summary = await this.activate(binding, token, account.displayName, capabilities);
      issuedAccessToken = null;
      return { returnPath: binding.returnPath, summary };
    } catch (error) {
      if (issuedAccessToken) await this.client.revokeToken(issuedAccessToken).catch(() => undefined);
      await this.auditBestEffort(binding, 'TIKTOK_CALLBACK_FAILED', callbackFailureCode(error), error);
      throw safeFailure();
    }
  }

  async disconnect(tenantId: string, userId: string): Promise<TikTokConnectionSummary> {
    const cleanupId = await withTenantTransaction(this.prisma, tenantId, async (transaction) => {
      await assertTenantAcceptingMutations(transaction, tenantId, 'META_INBOUND');
      const connection = await transaction.tikTokConnection.findUnique({
        where: { tenantId },
        select: {
          id: true,
          externalAccountId: true,
          encryptedAccessToken: true,
          encryptedRefreshToken: true,
          credentialGenerationId: true,
        },
      });
      const disconnectedAt = this.now();
      await transaction.tikTokOAuthAttempt.updateMany({ where: { tenantId }, data: { usedAt: disconnectedAt } });
      if (!connection?.encryptedAccessToken || !connection.credentialGenerationId) return null;

      const cleanup = await transaction.tikTokCredentialCleanup.upsert({
        where: { credentialGenerationId: connection.credentialGenerationId },
        create: {
          credentialGenerationId: connection.credentialGenerationId,
          tenantId,
          externalAccountId: connection.externalAccountId,
          encryptedAccessToken: connection.encryptedAccessToken,
          encryptedRefreshToken: connection.encryptedRefreshToken,
          source: 'DISCONNECT',
          state: 'REQUIRED',
        },
        update: {
          externalAccountId: connection.externalAccountId,
          encryptedAccessToken: connection.encryptedAccessToken,
          encryptedRefreshToken: connection.encryptedRefreshToken,
          source: 'DISCONNECT',
          state: 'REQUIRED',
          revokeStatus: 'PENDING',
          terminalAt: null,
          lastErrorCode: null,
        },
        select: { id: true },
      });
      await transaction.tikTokConnection.update({
        where: { id: connection.id },
        data: {
          status: 'DISCONNECTED',
          encryptedAccessToken: null,
          encryptedRefreshToken: null,
          credentialGenerationId: null,
          disconnectedAt,
          lastErrorCode: null,
        },
      });
      await this.recordAudit(transaction, { tenantId, userId }, 'TIKTOK_DISCONNECT_REQUESTED', 'SUCCESS');
      return cleanup.id;
    });

    if (cleanupId) await this.runCleanup(tenantId, cleanupId);
    return this.getSummary(tenantId);
  }

  async retryCleanup(tenantId: string, userId: string): Promise<TikTokConnectionSummary> {
    const rows = await withTenantTransaction(this.prisma, tenantId, (transaction) =>
      transaction.tikTokCredentialCleanup.findMany({
        where: { tenantId, terminalAt: null },
        select: { id: true },
      }));
    for (const row of rows) await this.runCleanup(tenantId, row.id);
    await withTenantTransaction(this.prisma, tenantId, (transaction) =>
      this.recordAudit(transaction, { tenantId, userId }, 'TIKTOK_CLEANUP_RETRIED', 'SUCCESS'));
    return this.getSummary(tenantId);
  }

  private async activate(
    binding: TikTokOAuthBinding,
    token: {
      accessToken: string;
      refreshToken: string;
      accountId: string;
      grantedScopes: string[];
      expiresIn: number;
      refreshTokenExpiresIn: number;
    },
    displayName: string,
    capabilities: TikTokCapabilities,
  ): Promise<TikTokConnectionSummary> {
    const activatedAt = this.now();
    const credentialGenerationId = randomUUID();
    const encryptedAccessToken = this.cipher.encrypt(token.accessToken);
    const encryptedRefreshToken = this.cipher.encrypt(token.refreshToken);
    const status = capabilities.sendText ? 'ACTIVE' : 'INBOUND_ONLY';

    const active = await withTenantTransaction(this.prisma, binding.tenantId, async (transaction) => {
      const cleanup = await transaction.tikTokCredentialCleanup.create({
        data: {
          credentialGenerationId,
          tenantId: binding.tenantId,
          externalAccountId: token.accountId,
          encryptedAccessToken,
          encryptedRefreshToken,
          source: 'CALLBACK_PREARM',
          state: 'ARMED',
        },
        select: { id: true },
      });
      const connection = await transaction.tikTokConnection.upsert({
        where: { tenantId: binding.tenantId },
        create: {
          tenantId: binding.tenantId,
          externalAccountId: token.accountId,
          displayName,
          status,
          capabilities: capabilities as Prisma.InputJsonValue,
          encryptedAccessToken,
          encryptedRefreshToken,
          credentialGenerationId,
          tokenExpiresAt: new Date(activatedAt.getTime() + token.expiresIn * 1_000),
          refreshTokenExpiresAt: new Date(activatedAt.getTime() + token.refreshTokenExpiresIn * 1_000),
          grantedScopes: [...new Set(token.grantedScopes)].sort().join(','),
          connectedByUserId: binding.userId,
          lastVerifiedAt: activatedAt,
          lastErrorCode: null,
          disconnectedAt: null,
        },
        update: {
          externalAccountId: token.accountId,
          displayName,
          status,
          capabilities: capabilities as Prisma.InputJsonValue,
          encryptedAccessToken,
          encryptedRefreshToken,
          credentialGenerationId,
          tokenExpiresAt: new Date(activatedAt.getTime() + token.expiresIn * 1_000),
          refreshTokenExpiresAt: new Date(activatedAt.getTime() + token.refreshTokenExpiresIn * 1_000),
          grantedScopes: [...new Set(token.grantedScopes)].sort().join(','),
          connectedByUserId: binding.userId,
          lastVerifiedAt: activatedAt,
          lastErrorCode: null,
          disconnectedAt: null,
        },
        select: SAFE_CONNECTION_SELECT,
      });
      await transaction.tikTokCredentialCleanup.updateMany({
        where: { id: cleanup.id, state: 'ARMED', terminalAt: null },
        data: {
          state: 'CANCELLED',
          callbackResolvedAt: activatedAt,
          terminalAt: activatedAt,
          encryptedAccessToken: '',
          encryptedRefreshToken: null,
          lastErrorCode: null,
          version: { increment: 1 },
        },
      });
      await this.recordAudit(transaction, binding, 'TIKTOK_CONNECTED', 'SUCCESS');
      return connection;
    });
    return toSummary(active, 'NONE');
  }

  private async assertNoConnectedCredentials(tenantId: string): Promise<void> {
    const existing = await withTenantTransaction(this.prisma, tenantId, (transaction) =>
      transaction.tikTokConnection.findUnique({
        where: { tenantId },
        select: { encryptedAccessToken: true, credentialGenerationId: true },
      }));
    if (existing?.encryptedAccessToken || existing?.credentialGenerationId) {
      throw new Error('TIKTOK_DISCONNECT_REQUIRED');
    }
  }

  private async runCleanup(tenantId: string, cleanupId: string): Promise<void> {
    const leaseId = randomUUID();
    const claimedAt = this.now();
    const cleanup = await withTenantTransaction(this.prisma, tenantId, async (transaction) => {
      const claimed = await transaction.tikTokCredentialCleanup.updateMany({
        where: {
          id: cleanupId,
          tenantId,
          state: 'REQUIRED',
          terminalAt: null,
          OR: [{ leaseId: null, leaseExpiresAt: null }, { leaseExpiresAt: { lte: claimedAt } }],
        },
        data: {
          leaseId,
          leaseExpiresAt: new Date(claimedAt.getTime() + CLEANUP_LEASE_MS),
          revokeStatus: 'PENDING',
          attempts: { increment: 1 },
          version: { increment: 1 },
        },
      });
      if (claimed.count !== 1) return null;
      return transaction.tikTokCredentialCleanup.findFirst({
        where: { id: cleanupId, tenantId, leaseId, terminalAt: null },
        select: { id: true, credentialGenerationId: true, encryptedAccessToken: true },
      });
    });
    if (!cleanup) return;

    try {
      await this.client.revokeToken(this.cipher.decrypt(cleanup.encryptedAccessToken));
      const completedAt = this.now();
      await withTenantTransaction(this.prisma, tenantId, async (transaction) => {
        const completed = await transaction.tikTokCredentialCleanup.updateMany({
          where: { id: cleanup.id, tenantId, leaseId, terminalAt: null },
          data: {
            state: 'COMPLETED',
            revokeStatus: 'SUCCEEDED',
            revokeAttemptedAt: completedAt,
            revokeSucceededAt: completedAt,
            terminalAt: completedAt,
            encryptedAccessToken: '',
            encryptedRefreshToken: null,
            lastErrorCode: null,
            leaseId: null,
            leaseExpiresAt: null,
            version: { increment: 1 },
          },
        });
        if (completed.count !== 1) return;
        await transaction.tikTokConnection.updateMany({
          where: { tenantId, credentialGenerationId: cleanup.credentialGenerationId },
          data: {
            status: 'DISCONNECTED',
            encryptedAccessToken: null,
            encryptedRefreshToken: null,
            credentialGenerationId: null,
            disconnectedAt: completedAt,
          },
        });
      });
    } catch {
      await withTenantTransaction(this.prisma, tenantId, async (transaction) => {
        await transaction.tikTokCredentialCleanup.updateMany({
          where: { id: cleanup.id, tenantId, leaseId, terminalAt: null },
          data: {
            state: 'REQUIRED',
            revokeStatus: 'FAILED',
            revokeAttemptedAt: this.now(),
            lastErrorCode: CLEANUP_FAILED_CODE,
            leaseId: null,
            leaseExpiresAt: null,
            version: { increment: 1 },
          },
        });
      });
    }
  }

  private async getCleanupStatus(tenantId: string): Promise<'NONE' | 'PENDING' | 'FAILED'> {
    const rows = await withTenantTransaction(this.prisma, tenantId, (transaction) =>
      transaction.tikTokCredentialCleanup.findMany({
        where: { tenantId, terminalAt: null },
        select: { revokeStatus: true, lastErrorCode: true },
      }));
    if (rows.length === 0) return 'NONE';
    return rows.some((row) => row.revokeStatus === 'FAILED' || row.lastErrorCode !== null) ? 'FAILED' : 'PENDING';
  }

  private async resolveAccountTenant(accountId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Array<{ tenant_id: string }>>`
      SELECT tenant_id FROM public.api_tiktok_tenant_for_account(${accountId})
    `;
    return rows[0]?.tenant_id ?? null;
  }

  private async hasActiveOwner(tenantId: string, userId: string): Promise<boolean> {
    try {
      const [tenant, membership] = await withTenantTransaction(this.prisma, tenantId, (transaction) => Promise.all([
        transaction.tenant.findUnique({ where: { id: tenantId }, select: { status: true } }),
        transaction.tenantMembership.findUnique({
          where: { userId_tenantId: { userId, tenantId } },
          select: { role: true, status: true, user: { select: { status: true } } },
        }),
      ]));
      return tenant?.status === 'ACTIVE' && membership?.role === 'OWNER' &&
        membership.status === 'ACTIVE' && membership.user.status === 'ACTIVE';
    } catch {
      return false;
    }
  }

  private recordAudit(
    client: Prisma.TransactionClient,
    binding: Pick<TikTokOAuthBinding, 'tenantId' | 'userId'>,
    action: string,
    result: 'SUCCESS' | 'FAILURE',
    errorCode?: string,
    providerError?: TikTokBusinessMessagingError,
  ): Promise<unknown> {
    return client.securityAuditLog.create({
      data: {
        tenantId: binding.tenantId,
        userId: binding.userId,
        actor: 'USER',
        action,
        result,
        metadata: {
          ...(errorCode ? { errorCode } : {}),
          ...(providerError ? {
            providerStage: providerError.stage,
            providerStatus: providerError.status,
            providerCode: providerError.providerCode,
            providerRequestId: providerError.requestId,
            providerRetryable: providerError.retryable,
          } : {}),
        },
      },
    });
  }

  private async auditBestEffort(
    binding: Pick<TikTokOAuthBinding, 'tenantId' | 'userId'>,
    action: string,
    errorCode: string,
    error?: unknown,
  ): Promise<void> {
    await withTenantTransaction(this.prisma, binding.tenantId, (transaction) =>
      this.recordAudit(
        transaction,
        binding,
        action,
        'FAILURE',
        errorCode,
        error instanceof TikTokBusinessMessagingError ? error : undefined,
      )).catch(() => undefined);
  }

  private assertEnabled(): void {
    if (!this.enabled) throw new Error('TikTok Business Messaging integration is disabled');
  }
}

function toSummary(
  connection: SafeConnectionRow,
  cleanupStatus: 'NONE' | 'PENDING' | 'FAILED',
  expired = false,
): TikTokConnectionSummary {
  return {
    status: expired ? 'REAUTH_REQUIRED' : connection.status,
    accountId: connection.externalAccountId,
    displayName: connection.displayName,
    capabilities: parseCapabilities(connection.capabilities),
    tokenExpiresAt: connection.tokenExpiresAt?.toISOString() ?? null,
    lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
    lastErrorCode: expired ? 'TIKTOK_TOKEN_EXPIRED' : connection.lastErrorCode,
    cleanupStatus,
  };
}

function emptySummary(cleanupStatus: 'NONE' | 'PENDING' | 'FAILED'): TikTokConnectionSummary {
  return {
    status: 'NOT_CONNECTED',
    accountId: null,
    displayName: null,
    capabilities: null,
    tokenExpiresAt: null,
    lastVerifiedAt: null,
    lastErrorCode: null,
    cleanupStatus,
  };
}

function parseCapabilities(value: Prisma.JsonValue | null): TikTokCapabilities | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.receiveMessages !== 'boolean' ||
    typeof candidate.sendText !== 'boolean' ||
    typeof candidate.sendImage !== 'boolean'
  ) return null;
  return {
    receiveMessages: candidate.receiveMessages,
    sendText: candidate.sendText,
    sendImage: candidate.sendImage,
  };
}

function callbackFailureCode(error: unknown): string {
  if (error instanceof TikTokBusinessMessagingError) return 'TIKTOK_PROVIDER_FAILED';
  if (error instanceof Error && /^TIKTOK_[A-Z_]+$/.test(error.message)) return error.message;
  return 'TIKTOK_ACTIVATION_FAILED';
}

function safeFailure(): Error {
  return new Error(SAFE_FAILURE_MESSAGE);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

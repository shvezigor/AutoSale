import { randomUUID } from 'node:crypto';

import { type Prisma, type PrismaClient } from '@autosale/database';
import {
  MetaInstagramError,
  type MetaInstagramClient,
} from '@autosale/integrations';

import { CredentialCipher } from './credential-cipher.js';
import { InstagramOAuthStateService } from './instagram-oauth-state.service.js';

const CALLBACK_PATH = '/api/integrations/instagram/callback';
const REQUIRED_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
] as const;
const SAFE_FAILURE_MESSAGE = 'Instagram connection failed';
const CLEANUP_FAILED_CODE = 'META_DISCONNECT_CLEANUP_FAILED';
const CLEANUP_LEASE_MS = 5 * 60 * 1000;
const CLEANUP_RETRY_BATCH_LIMIT = 25;

const SAFE_CONNECTION_SELECT = {
  externalAccountId: true,
  displayName: true,
  status: true,
  tokenExpiresAt: true,
  lastVerifiedAt: true,
  lastErrorCode: true,
} as const;

const CLEANUP_CONNECTION_SELECT = {
  ...SAFE_CONNECTION_SELECT,
  id: true,
  tenantId: true,
  encryptedAccessToken: true,
  disconnectedAt: true,
} as const;

const CLEANUP_ROW_SELECT = {
  id: true,
  tenantId: true,
  externalAccountId: true,
  encryptedAccessToken: true,
  source: true,
  unsubscribeStatus: true,
  revokeStatus: true,
  attempts: true,
  leaseId: true,
  leaseExpiresAt: true,
  version: true,
  lastErrorCode: true,
  terminalAt: true,
} as const;

const CLEANUP_SUMMARY_SELECT = {
  unsubscribeStatus: true,
  revokeStatus: true,
  lastErrorCode: true,
} as const;

type SafeConnectionRow = {
  externalAccountId: string;
  displayName: string | null;
  status: 'LEGACY' | 'ACTIVE' | 'REAUTH_REQUIRED' | 'ERROR' | 'DISCONNECTED';
  tokenExpiresAt: Date | null;
  lastVerifiedAt: Date | null;
  lastErrorCode: string | null;
};

type OAuthBinding = { id: string; tenantId: string; userId: string; returnPath?: string };

type CleanupOperationStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';
type CleanupPublicStatus = 'NONE' | 'PENDING' | 'FAILED';
type CleanupOperation = 'UNSUBSCRIBE' | 'REVOKE';
type CleanupSource = 'DISCONNECT' | 'CALLBACK_COMPENSATION' | 'SUBSCRIPTION_FAILURE';

type CleanupSummary = {
  status: CleanupPublicStatus;
  errorCode: string | null;
};

type CleanupSummaryRow = {
  unsubscribeStatus: CleanupOperationStatus;
  revokeStatus: CleanupOperationStatus;
  lastErrorCode: string | null;
};

type CleanupRow = {
  id: string;
  tenantId: string;
  externalAccountId: string;
  encryptedAccessToken: string;
  source: string;
  unsubscribeStatus: CleanupOperationStatus;
  revokeStatus: CleanupOperationStatus;
  attempts: number;
  leaseId: string | null;
  leaseExpiresAt: Date | null;
  version: number;
  lastErrorCode: string | null;
  terminalAt: Date | null;
};

type LeasedCleanupRow = CleanupRow & {
  leaseId: string;
  leaseExpiresAt: Date;
};

type PendingCredential = {
  externalAccountId: string;
  encryptedAccessToken: string;
};

export type InstagramConnectionSummary = {
  status: 'NOT_CONNECTED' | SafeConnectionRow['status'];
  accountId: string | null;
  username: string | null;
  tokenExpiresAt: string | null;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
  cleanupStatus: CleanupPublicStatus;
  cleanupErrorCode: string | null;
};

export class InstagramOAuthService {
  private readonly callbackUri: string;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly meta: MetaInstagramClient,
    private readonly states: InstagramOAuthStateService,
    private readonly cipher: CredentialCipher,
    appPublicUrl: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.callbackUri = new URL(CALLBACK_PATH, ensureTrailingSlash(appPublicUrl)).toString();
  }

  async getSummary(tenantId: string): Promise<InstagramConnectionSummary> {
    const [connection, cleanup] = await Promise.all([
      this.prisma.instagramConnection.findUnique({
        where: { tenantId },
        select: SAFE_CONNECTION_SELECT,
      }),
      this.getCleanupSummary(tenantId),
    ]);

    if (!connection) return emptySummary(cleanup);

    const checkedAt = this.now();
    const expired = isExpiredActiveConnection(connection, checkedAt);
    if (expired) {
      await this.markExpired(tenantId, checkedAt);
    }
    return toSummary(connection, expired, cleanup);
  }

  async connect(
    tenantId: string,
    userId: string,
    returnPath?: string,
  ): Promise<{ authorizationUrl: string }> {
    const state = await this.states.create({
      tenantId,
      userId,
      ...(returnPath === undefined ? {} : { returnPath }),
    });
    return {
      authorizationUrl: this.meta.getAuthorizationUrl({
        state,
        redirectUri: this.callbackUri,
      }),
    };
  }

  async completeCallback(
    code: string | undefined,
    rawState: string,
    authorizationDenied = false,
  ): Promise<{ returnPath: string; summary: InstagramConnectionSummary }> {
    let binding: { id: string; tenantId: string; userId: string; returnPath: string };
    try {
      binding = await this.states.consume(rawState);
    } catch {
      throw safeFailure();
    }

    if (!await this.hasActiveOwner(binding.tenantId, binding.userId)) {
      await this.recordAuditBestEffort(binding, 'INSTAGRAM_CALLBACK_FAILED', 'FAILURE', { errorCode: 'META_OWNER_INVALID' });
      throw safeFailure();
    }

    if (authorizationDenied) {
      await this.markCallbackFailure(binding, 'ERROR', 'META_AUTHORIZATION_DENIED');
      throw safeFailure();
    }

    if (!code) {
      await this.markCallbackFailure(binding, 'ERROR', 'META_CALLBACK_INVALID');
      throw safeFailure();
    }

    let accessToken: string;
    let expiresIn: number;
    let identity: { accountId: string; username: string | null };
    let grantedScopes: string[];
    try {
      const token = await this.meta.exchangeCode({ code, redirectUri: this.callbackUri });
      accessToken = token.accessToken;
      expiresIn = token.expiresIn;
      identity = await this.meta.getIdentity(accessToken);
      grantedScopes = token.grantedScopes;
    } catch (error) {
      const authorizationFailure = isAuthorizationFailure(error);
      await this.markCallbackFailure(
        binding,
        authorizationFailure ? 'REAUTH_REQUIRED' : 'ERROR',
        authorizationFailure ? 'META_AUTHORIZATION_FAILED' : 'META_PROVIDER_FAILED',
      );
      throw safeFailure();
    }

    if (!hasRequiredScopes(grantedScopes)) {
      await this.markCallbackFailure(binding, 'ERROR', 'META_REQUIRED_SCOPES_MISSING');
      throw safeFailure();
    }

    const connectedAt = this.now();
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      await this.markCallbackFailure(binding, 'REAUTH_REQUIRED', 'META_TOKEN_EXPIRED');
      throw safeFailure();
    }

    const pendingCredential = {
      externalAccountId: identity.accountId,
      encryptedAccessToken: this.cipher.encrypt(accessToken),
    };
    const pendingData = {
      externalAccountId: identity.accountId,
      displayName: identity.username,
      status: 'ERROR' as const,
      encryptedAccessToken: pendingCredential.encryptedAccessToken,
      tokenExpiresAt: new Date(connectedAt.getTime() + expiresIn * 1000),
      grantedScopes: grantedScopes.join(','),
      lastVerifiedAt: null,
      lastErrorCode: null,
      connectedByUserId: binding.userId,
      disconnectedAt: null,
    };

    try {
      await this.withCurrentAttempt(binding, async (transaction) => {
        const owner = await transaction.instagramConnection.findUnique({ where: { externalAccountId: identity.accountId }, select: { tenantId: true } });
        if (owner && owner.tenantId !== binding.tenantId) throw safeFailure();
        await transaction.instagramConnection.upsert({
          where: { tenantId: binding.tenantId },
          create: { tenantId: binding.tenantId, ...pendingData },
          update: pendingData,
        });
      });
    } catch {
      // A concurrent unique-account claim must never overwrite the owning tenant.
      await this.markCallbackFailure(binding, 'ERROR', 'META_CONNECTION_FAILED');
      throw safeFailure();
    }

    try {
      await this.meta.subscribe(accessToken);
    } catch {
      const cleanup = await this.enqueueCallbackCleanup(
        binding,
        pendingCredential,
        'SUBSCRIPTION_FAILURE',
        'META_SUBSCRIPTION_FAILED',
      );
      if (cleanup) await this.cleanupCredentialById(cleanup.id, binding.userId);
      await this.markCallbackFailure(binding, 'ERROR', 'META_SUBSCRIPTION_FAILED');
      throw safeFailure();
    }

    let active: SafeConnectionRow;
    try {
      active = await this.withCurrentAttempt(binding, (transaction) => {
        if (pendingData.tokenExpiresAt <= this.now()) throw safeFailure();
        return transaction.instagramConnection.update({
          where: { tenantId: binding.tenantId },
          data: {
            status: 'ACTIVE',
            lastVerifiedAt: connectedAt,
            lastErrorCode: null,
            disconnectedAt: null,
          },
          select: SAFE_CONNECTION_SELECT,
        }).then(async (connection) => {
          await this.recordAudit(transaction, binding, 'INSTAGRAM_CONNECTED', 'SUCCESS');
          return connection;
        });
      });
    } catch {
      const cleanup = await this.enqueueCallbackCleanup(
        binding,
        pendingCredential,
        'CALLBACK_COMPENSATION',
        'META_ACTIVATION_FAILED',
      );
      if (cleanup) await this.cleanupCredentialById(cleanup.id, binding.userId);
      await this.recordAuditBestEffort(binding, 'INSTAGRAM_CALLBACK_FAILED', 'FAILURE', { errorCode: 'META_ACTIVATION_FAILED' });
      throw safeFailure();
    }

    return {
      returnPath: binding.returnPath,
      summary: toSummary(active, false, await this.getCleanupSummary(binding.tenantId)),
    };
  }

  async disconnect(tenantId: string, userId: string): Promise<InstagramConnectionSummary> {
    const cleanupId = await this.prepareDisconnect(tenantId, userId);
    if (cleanupId) await this.cleanupCredentialById(cleanupId, userId);
    return this.getSummary(tenantId);
  }

  async retryCleanup(tenantId: string, userId: string): Promise<InstagramConnectionSummary> {
    await this.cleanupAvailableCredentials(tenantId, userId);
    return this.getSummary(tenantId);
  }

  private async prepareDisconnect(
    tenantId: string,
    userId: string,
  ): Promise<string | null> {
    return this.withSerializableRetry(() => this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.tenant.updateMany({
        where: { id: tenantId },
        data: { instagramOAuthCurrentAttemptId: null },
      });
      if (locked.count !== 1) throw safeFailure();
      const disconnectedAt = this.now();
      await transaction.instagramOAuthState.updateMany({
        where: { tenantId, usedAt: null },
        data: { usedAt: disconnectedAt },
      });
      await this.recordAudit(
        transaction,
        { tenantId, userId },
        'INSTAGRAM_DISCONNECT_REQUESTED',
        'SUCCESS',
      );

      const connection = await transaction.instagramConnection.findUnique({
        where: { tenantId },
        select: CLEANUP_CONNECTION_SELECT,
      });
      if (!connection) {
        await this.recordAudit(
          transaction,
          { tenantId, userId },
          'INSTAGRAM_DISCONNECTED',
          'SUCCESS',
        );
        return null;
      }

      if (connection.encryptedAccessToken === null) {
        await transaction.instagramConnection.update({
          where: { id: connection.id },
          data: {
            status: 'DISCONNECTED',
            encryptedAccessToken: null,
            tokenExpiresAt: null,
            grantedScopes: null,
            disconnectedAt,
            lastErrorCode: null,
          },
          select: SAFE_CONNECTION_SELECT,
        });
        await this.recordAudit(
          transaction,
          { tenantId, userId },
          'INSTAGRAM_DISCONNECTED',
          'SUCCESS',
        );
        return null;
      }

      await transaction.instagramConnection.update({
        where: { id: connection.id },
        data: {
          status: 'DISCONNECTED',
          encryptedAccessToken: null,
          tokenExpiresAt: null,
          grantedScopes: null,
          disconnectedAt,
          lastErrorCode: null,
        },
        select: SAFE_CONNECTION_SELECT,
      });
      const cleanup = await transaction.instagramCredentialCleanup.create({
        data: {
          tenantId,
          externalAccountId: connection.externalAccountId,
          encryptedAccessToken: connection.encryptedAccessToken,
          source: 'DISCONNECT',
        },
        select: CLEANUP_ROW_SELECT,
      });
      await this.recordAudit(
        transaction,
        { tenantId, userId },
        'INSTAGRAM_CREDENTIAL_CLEANUP_QUEUED',
        'SUCCESS',
      );
      return cleanup.id;
    }, { isolationLevel: 'Serializable' }));
  }

  private async enqueueCallbackCleanup(
    binding: OAuthBinding,
    credential: PendingCredential,
    source: Exclude<CleanupSource, 'DISCONNECT'>,
    lastErrorCode: string,
  ): Promise<CleanupRow | null> {
    try {
      const cleanup = await this.withSerializableRetry(() => this.prisma.$transaction(async (transaction) => {
        const row = await transaction.instagramCredentialCleanup.create({
          data: {
            tenantId: binding.tenantId,
            externalAccountId: credential.externalAccountId,
            encryptedAccessToken: credential.encryptedAccessToken,
            source,
          },
          select: CLEANUP_ROW_SELECT,
        });
        await transaction.instagramConnection.updateMany({
          where: {
            tenantId: binding.tenantId,
            encryptedAccessToken: credential.encryptedAccessToken,
            status: { not: 'ACTIVE' },
          },
          data: {
            encryptedAccessToken: null,
            tokenExpiresAt: null,
            grantedScopes: null,
            lastErrorCode,
          },
        });
        return row;
      }, { isolationLevel: 'Serializable' }));
      await this.recordAuditBestEffort(
        binding,
        'INSTAGRAM_CREDENTIAL_CLEANUP_QUEUED',
        'SUCCESS',
        { errorCode: lastErrorCode },
      );
      return cleanup;
    } catch {
      await this.recordAuditBestEffort(
        binding,
        'INSTAGRAM_CALLBACK_FAILED',
        'FAILURE',
        { errorCode: lastErrorCode },
      );
      return null;
    }
  }

  private async cleanupAvailableCredentials(tenantId: string, userId: string): Promise<void> {
    const attemptedIds = new Set<string>();
    for (let attempt = 0; attempt < CLEANUP_RETRY_BATCH_LIMIT; attempt += 1) {
      const cleanup = await this.leaseNextCleanup(tenantId, [...attemptedIds]);
      if (!cleanup) return;
      attemptedIds.add(cleanup.id);
      await this.cleanupLeasedCredential(cleanup, userId);
    }
  }

  private async cleanupCredentialById(cleanupId: string, userId: string): Promise<void> {
    const cleanup = await this.leaseCleanupById(cleanupId);
    if (!cleanup) return;
    await this.cleanupLeasedCredential(cleanup, userId);
  }

  private async leaseCleanupById(cleanupId: string): Promise<LeasedCleanupRow | null> {
    const row = await this.prisma.instagramCredentialCleanup.findUnique({
      where: { id: cleanupId },
      select: CLEANUP_ROW_SELECT,
    });
    if (!row || row.terminalAt !== null) return null;
    return this.leaseCleanupRow(row);
  }

  private async leaseNextCleanup(tenantId: string, excludedIds: string[]): Promise<LeasedCleanupRow | null> {
    const checkedAt = this.now();
    const row = await this.prisma.instagramCredentialCleanup.findFirst({
      where: {
        tenantId,
        terminalAt: null,
        ...(excludedIds.length > 0 ? { id: { notIn: excludedIds } } : {}),
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: checkedAt } }],
      },
      orderBy: { createdAt: 'asc' },
      select: CLEANUP_ROW_SELECT,
    });
    if (!row) return null;
    return this.leaseCleanupRow(row, checkedAt);
  }

  private async leaseCleanupRow(row: CleanupRow, leasedAt = this.now()): Promise<LeasedCleanupRow | null> {
    const leaseId = randomUUID();
    const leaseExpiresAt = new Date(leasedAt.getTime() + CLEANUP_LEASE_MS);
    const rows = await this.prisma.instagramCredentialCleanup.updateManyAndReturn({
      where: {
        id: row.id,
        version: row.version,
        terminalAt: null,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: leasedAt } }],
      },
      data: {
        leaseId,
        leaseExpiresAt,
        attempts: { increment: 1 },
        version: { increment: 1 },
      },
      select: CLEANUP_ROW_SELECT,
    });
    return asLeasedCleanup(rows[0]);
  }

  private async cleanupLeasedCredential(cleanup: LeasedCleanupRow, userId: string): Promise<void> {
    await this.recordAuditBestEffort(
      { tenantId: cleanup.tenantId, userId },
      'INSTAGRAM_CREDENTIAL_CLEANUP_STARTED',
      'SUCCESS',
    );

    let accessToken: string;
    try {
      accessToken = this.cipher.decrypt(cleanup.encryptedAccessToken);
    } catch {
      await this.markCleanupFailed(cleanup, 'UNSUBSCRIBE', userId);
      return;
    }

    let current = cleanup;
    if (current.unsubscribeStatus !== 'SUCCEEDED') {
      const attempted = await this.markCleanupAttempt(current, 'UNSUBSCRIBE');
      if (!attempted) return;
      current = attempted;
      try {
        await this.meta.unsubscribe(accessToken);
      } catch {
        await this.markCleanupFailed(current, 'UNSUBSCRIBE', userId);
        return;
      }
      const succeeded = await this.markCleanupSucceeded(current, 'UNSUBSCRIBE');
      if (!succeeded) return;
      current = succeeded;
      await this.recordAuditBestEffort(
        { tenantId: current.tenantId, userId },
        'INSTAGRAM_CREDENTIAL_CLEANUP_PROGRESS',
        'SUCCESS',
        { operation: 'UNSUBSCRIBE' },
      );
    }

    if (current.revokeStatus !== 'SUCCEEDED') {
      const attempted = await this.markCleanupAttempt(current, 'REVOKE');
      if (!attempted) return;
      current = attempted;
      try {
        await this.meta.revoke(accessToken);
      } catch {
        await this.markCleanupFailed(current, 'REVOKE', userId);
        return;
      }
      const succeeded = await this.markCleanupSucceeded(current, 'REVOKE');
      if (!succeeded) return;
      current = succeeded;
      await this.recordAuditBestEffort(
        { tenantId: current.tenantId, userId },
        'INSTAGRAM_CREDENTIAL_CLEANUP_PROGRESS',
        'SUCCESS',
        { operation: 'REVOKE' },
      );
    }

    await this.markCleanupCompleted(current, userId);
  }

  private async markCleanupAttempt(
    cleanup: LeasedCleanupRow,
    operation: CleanupOperation,
  ): Promise<LeasedCleanupRow | null> {
    const attemptedAt = this.now();
    const updated = await this.updateLeasedCleanup(cleanup, operation === 'UNSUBSCRIBE'
      ? { unsubscribeStatus: 'PENDING', unsubscribeAttemptedAt: attemptedAt, lastErrorCode: null }
      : { revokeStatus: 'PENDING', revokeAttemptedAt: attemptedAt, lastErrorCode: null });
    return asLeasedCleanup(updated);
  }

  private async markCleanupSucceeded(
    cleanup: LeasedCleanupRow,
    operation: CleanupOperation,
  ): Promise<LeasedCleanupRow | null> {
    const succeededAt = this.now();
    const updated = await this.updateLeasedCleanup(cleanup, operation === 'UNSUBSCRIBE'
      ? { unsubscribeStatus: 'SUCCEEDED', unsubscribeSucceededAt: succeededAt, lastErrorCode: null }
      : { revokeStatus: 'SUCCEEDED', revokeSucceededAt: succeededAt, lastErrorCode: null });
    return asLeasedCleanup(updated);
  }

  private async markCleanupFailed(
    cleanup: LeasedCleanupRow,
    operation: CleanupOperation,
    userId: string,
  ): Promise<void> {
    const failedAt = this.now();
    const failed = await this.updateLeasedCleanup(cleanup, {
      ...(operation === 'UNSUBSCRIBE'
        ? { unsubscribeStatus: 'FAILED', unsubscribeAttemptedAt: failedAt }
        : { revokeStatus: 'FAILED', revokeAttemptedAt: failedAt }),
      lastErrorCode: CLEANUP_FAILED_CODE,
      leaseId: null,
      leaseExpiresAt: null,
    });
    if (!failed) return;
    await this.recordAuditBestEffort(
      { tenantId: cleanup.tenantId, userId },
      'INSTAGRAM_CREDENTIAL_CLEANUP_FAILED',
      'FAILURE',
      { errorCode: CLEANUP_FAILED_CODE },
    );
  }

  private async markCleanupCompleted(cleanup: LeasedCleanupRow, userId: string): Promise<void> {
    const completed = await this.updateLeasedCleanup(cleanup, {
      terminalAt: this.now(),
      lastErrorCode: null,
      leaseId: null,
      leaseExpiresAt: null,
    });
    if (!completed) return;
    await this.recordAuditBestEffort(
      { tenantId: cleanup.tenantId, userId },
      'INSTAGRAM_CREDENTIAL_CLEANUP_COMPLETED',
      'SUCCESS',
    );
    if (cleanup.source === 'DISCONNECT') {
      await this.recordAuditBestEffort(
        { tenantId: cleanup.tenantId, userId },
        'INSTAGRAM_DISCONNECTED',
        'SUCCESS',
      );
    }
  }

  private async updateLeasedCleanup(
    cleanup: LeasedCleanupRow,
    data: Prisma.InstagramCredentialCleanupUpdateManyMutationInput,
  ): Promise<CleanupRow | null> {
    const rows = await this.prisma.instagramCredentialCleanup.updateManyAndReturn({
      where: {
        id: cleanup.id,
        leaseId: cleanup.leaseId,
        version: cleanup.version,
        terminalAt: null,
      },
      data: {
        ...data,
        version: { increment: 1 },
      },
      select: CLEANUP_ROW_SELECT,
    });
    return rows[0] ?? null;
  }

  private async getCleanupSummary(tenantId: string): Promise<CleanupSummary> {
    const rows = await this.prisma.instagramCredentialCleanup.findMany({
      where: { tenantId, terminalAt: null },
      select: CLEANUP_SUMMARY_SELECT,
    });
    return summarizeCleanup(rows);
  }

  private async markCallbackFailure(
    binding: OAuthBinding,
    status: 'REAUTH_REQUIRED' | 'ERROR',
    lastErrorCode: string,
  ): Promise<void> {
    try {
      await this.withCurrentAttempt(binding, async (transaction) => {
        await transaction.instagramConnection.updateMany({
          where: { tenantId: binding.tenantId },
          data: { status, lastErrorCode },
        });
        await this.recordAudit(
          transaction,
          binding,
          'INSTAGRAM_CALLBACK_FAILED',
          'FAILURE',
          { errorCode: lastErrorCode },
        );
      });
    } catch {
      // A superseded attempt must not change the current connection.
      await this.recordAuditBestEffort(
        binding,
        'INSTAGRAM_CALLBACK_FAILED',
        'FAILURE',
        { errorCode: lastErrorCode },
      );
    }
  }

  private recordAudit(
    client: Prisma.TransactionClient | PrismaClient,
    binding: Pick<OAuthBinding, 'tenantId' | 'userId'>,
    action: string,
    result: 'SUCCESS' | 'FAILURE',
    metadata: Record<string, string> = {},
  ): Promise<unknown> {
    return client.securityAuditLog.create({
      data: {
        tenantId: binding.tenantId,
        userId: binding.userId,
        actor: 'USER',
        action,
        result,
        metadata,
      },
    });
  }

  private async recordAuditBestEffort(
    binding: Pick<OAuthBinding, 'tenantId' | 'userId'>,
    action: string,
    result: 'SUCCESS' | 'FAILURE',
    metadata: Record<string, string> = {},
  ): Promise<void> {
    try {
      await this.recordAudit(this.prisma, binding, action, result, metadata);
    } catch {
      // Audit persistence failure must not expose callback or provider details.
    }
  }

  private async markExpired(tenantId: string, checkedAt: Date): Promise<void> {
    try {
      await this.prisma.instagramConnection.updateMany({
        where: { tenantId, status: 'ACTIVE', tokenExpiresAt: { lte: checkedAt } },
        data: { status: 'REAUTH_REQUIRED', lastErrorCode: 'META_TOKEN_EXPIRED' },
      });
    } catch {
      // The safe summary still reports the expired credential as unusable.
    }
  }

  private async hasActiveOwner(tenantId: string, userId: string): Promise<boolean> {
    try {
      const [tenant, membership] = await Promise.all([
        this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { status: true },
        }),
        this.prisma.tenantMembership.findUnique({
          where: { userId_tenantId: { userId, tenantId } },
          select: { role: true, status: true, user: { select: { status: true } } },
        }),
      ]);
      return tenant?.status === 'ACTIVE' &&
        membership?.status === 'ACTIVE' &&
        membership.role === 'OWNER' &&
        membership.user.status === 'ACTIVE';
    } catch {
      return false;
    }
  }

  private async withCurrentAttempt<T>(
    binding: OAuthBinding,
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.withSerializableRetry(() => this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.tenant.updateMany({
        where: { id: binding.tenantId, instagramOAuthCurrentAttemptId: binding.id, status: 'ACTIVE' },
        data: { instagramOAuthCurrentAttemptId: binding.id },
      });
      if (locked.count !== 1) throw safeFailure();
      const user = await transaction.user.updateMany({ where: { id: binding.userId, status: 'ACTIVE' }, data: { status: 'ACTIVE' } });
      const membership = await transaction.tenantMembership.updateMany({ where: { userId: binding.userId, tenantId: binding.tenantId, status: 'ACTIVE', role: 'OWNER' }, data: { role: 'OWNER' } });
      if (locked.count !== 1 || user.count !== 1 || membership.count !== 1) throw safeFailure();
      return operation(transaction);
    }, { isolationLevel: 'Serializable' }));
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

function toSummary(
  connection: SafeConnectionRow,
  expired = false,
  cleanup = noCleanup(),
): InstagramConnectionSummary {
  return {
    status: expired ? 'REAUTH_REQUIRED' : connection.status,
    accountId: connection.externalAccountId,
    username: connection.displayName,
    tokenExpiresAt: connection.tokenExpiresAt?.toISOString() ?? null,
    lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
    lastErrorCode: expired ? 'META_TOKEN_EXPIRED' : connection.lastErrorCode,
    cleanupStatus: cleanup.status,
    cleanupErrorCode: cleanup.errorCode,
  };
}

function emptySummary(cleanup = noCleanup()): InstagramConnectionSummary {
  return {
    status: 'NOT_CONNECTED',
    accountId: null,
    username: null,
    tokenExpiresAt: null,
    lastVerifiedAt: null,
    lastErrorCode: null,
    cleanupStatus: cleanup.status,
    cleanupErrorCode: cleanup.errorCode,
  };
}

function summarizeCleanup(rows: CleanupSummaryRow[]): CleanupSummary {
  if (rows.length === 0) return noCleanup();
  const failed = rows.find((row) =>
    row.lastErrorCode !== null ||
    row.unsubscribeStatus === 'FAILED' ||
    row.revokeStatus === 'FAILED');
  if (failed) return { status: 'FAILED', errorCode: failed.lastErrorCode ?? CLEANUP_FAILED_CODE };
  return { status: 'PENDING', errorCode: null };
}

function noCleanup(): CleanupSummary {
  return { status: 'NONE', errorCode: null };
}

function asLeasedCleanup(row: CleanupRow | undefined | null): LeasedCleanupRow | null {
  if (!row || row.leaseId === null || row.leaseExpiresAt === null) return null;
  return { ...row, leaseId: row.leaseId, leaseExpiresAt: row.leaseExpiresAt };
}

function hasRequiredScopes(grantedScopes: string[]): boolean {
  const granted = new Set(grantedScopes);
  return REQUIRED_SCOPES.every((scope) => granted.has(scope));
}

function isExpiredActiveConnection(connection: SafeConnectionRow, now: Date): boolean {
  return connection.status === 'ACTIVE' &&
    connection.tokenExpiresAt !== null &&
    connection.tokenExpiresAt.getTime() <= now.getTime();
}

function isAuthorizationFailure(error: unknown): boolean {
  return error instanceof MetaInstagramError &&
    (error.status === 400 || error.status === 401 || error.status === 403 || error.providerCode === 190);
}

function isSerializableConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034';
}

function safeFailure(): Error {
  return new Error(SAFE_FAILURE_MESSAGE);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

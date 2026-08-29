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
const CLEANUP_PENDING_CODE = 'META_DISCONNECT_CLEANUP_PENDING';
const CLEANUP_FAILED_CODE = 'META_DISCONNECT_CLEANUP_FAILED';

const SAFE_CONNECTION_SELECT = {
  externalAccountId: true,
  displayName: true,
  status: true,
  tokenExpiresAt: true,
  lastVerifiedAt: true,
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

type CleanupSnapshot = {
  id: string;
  tenantId: string;
  encryptedAccessToken: string;
  disconnectedAt: Date;
  lastErrorCode: typeof CLEANUP_PENDING_CODE | typeof CLEANUP_FAILED_CODE;
};

const CLEANUP_CONNECTION_SELECT = {
  ...SAFE_CONNECTION_SELECT,
  id: true,
  tenantId: true,
  encryptedAccessToken: true,
  disconnectedAt: true,
} as const;

export type InstagramConnectionSummary = {
  status: 'NOT_CONNECTED' | SafeConnectionRow['status'];
  accountId: string | null;
  username: string | null;
  tokenExpiresAt: string | null;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
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
    const connection = await this.prisma.instagramConnection.findUnique({
      where: { tenantId },
      select: SAFE_CONNECTION_SELECT,
    });

    if (!connection) return emptySummary();

    const checkedAt = this.now();
    const expired = isExpiredActiveConnection(connection, checkedAt);
    if (expired) {
      await this.markExpired(tenantId, checkedAt);
    }
    return toSummary(connection, expired);
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
      await this.recordAuditBestEffort(binding, 'INSTAGRAM_CALLBACK_FAILED', 'FAILURE', 'META_OWNER_INVALID');
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

    const pendingData = {
      externalAccountId: identity.accountId,
      displayName: identity.username,
      status: 'ERROR' as const,
      encryptedAccessToken: this.cipher.encrypt(accessToken),
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
      await this.markCallbackFailure(binding, 'ERROR', 'META_ACTIVATION_FAILED');
      throw safeFailure();
    }

    return { returnPath: binding.returnPath, summary: toSummary(active) };
  }

  async disconnect(tenantId: string, userId: string): Promise<InstagramConnectionSummary> {
    const prepared = await this.prepareDisconnect(tenantId, userId);
    if (!prepared.snapshot) return prepared.summary;
    return this.cleanupCredential(prepared.snapshot, userId);
  }

  async retryCleanup(tenantId: string, userId: string): Promise<InstagramConnectionSummary> {
    const prepared = await this.withSerializableRetry(() => this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.tenant.updateMany({
        where: { id: tenantId, instagramOAuthCurrentAttemptId: null },
        data: { instagramOAuthCurrentAttemptId: null },
      });
      if (locked.count !== 1) throw safeFailure();
      const connection = await transaction.instagramConnection.findUnique({
        where: { tenantId },
        select: CLEANUP_CONNECTION_SELECT,
      });
      if (!connection) return { summary: emptySummary(), snapshot: null };
      const summary = toSummary(connection);
      if (
        connection.status !== 'DISCONNECTED' ||
        connection.encryptedAccessToken === null ||
        connection.disconnectedAt === null ||
        (connection.lastErrorCode !== CLEANUP_PENDING_CODE && connection.lastErrorCode !== CLEANUP_FAILED_CODE)
      ) {
        return { summary, snapshot: null };
      }
      return {
        summary,
        snapshot: {
          id: connection.id,
          tenantId,
          encryptedAccessToken: connection.encryptedAccessToken,
          disconnectedAt: connection.disconnectedAt,
          lastErrorCode: connection.lastErrorCode,
        } satisfies CleanupSnapshot,
      };
    }, { isolationLevel: 'Serializable' }));
    if (!prepared.snapshot) return prepared.summary;
    return this.cleanupCredential(prepared.snapshot, userId);
  }

  private async prepareDisconnect(
    tenantId: string,
    userId: string,
  ): Promise<{ summary: InstagramConnectionSummary; snapshot: CleanupSnapshot | null }> {
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
        return { summary: emptySummary(), snapshot: null };
      }

      if (connection.encryptedAccessToken === null) {
        const disconnected = await transaction.instagramConnection.update({
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
        return { summary: toSummary(disconnected), snapshot: null };
      }

      const disabled = await transaction.instagramConnection.update({
        where: { id: connection.id },
        data: {
          status: 'DISCONNECTED',
          disconnectedAt,
          lastErrorCode: CLEANUP_PENDING_CODE,
        },
        select: SAFE_CONNECTION_SELECT,
      });
      return {
        summary: toSummary(disabled),
        snapshot: {
          id: connection.id,
          tenantId,
          encryptedAccessToken: connection.encryptedAccessToken,
          disconnectedAt,
          lastErrorCode: CLEANUP_PENDING_CODE,
        },
      };
    }, { isolationLevel: 'Serializable' }));
  }

  private async cleanupCredential(snapshot: CleanupSnapshot, userId: string): Promise<InstagramConnectionSummary> {
    let cleanupSucceeded = false;
    try {
      const accessToken = this.cipher.decrypt(snapshot.encryptedAccessToken);
      const cleanup = await Promise.allSettled([
        this.meta.unsubscribe(accessToken),
        this.meta.revoke(accessToken),
      ]);
      cleanupSucceeded = cleanup.every((result) => result.status === 'fulfilled');
    } catch {
      cleanupSucceeded = false;
    }

    const finalized = await this.withSerializableRetry(() => this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.tenant.updateMany({
        where: { id: snapshot.tenantId, instagramOAuthCurrentAttemptId: null },
        data: { instagramOAuthCurrentAttemptId: null },
      });
      if (locked.count !== 1) return null;
      const rows = await transaction.instagramConnection.updateManyAndReturn({
        where: {
          id: snapshot.id,
          tenantId: snapshot.tenantId,
          encryptedAccessToken: snapshot.encryptedAccessToken,
          status: 'DISCONNECTED',
          disconnectedAt: snapshot.disconnectedAt,
          lastErrorCode: snapshot.lastErrorCode,
        },
        data: cleanupSucceeded
          ? {
              encryptedAccessToken: null,
              tokenExpiresAt: null,
              grantedScopes: null,
              lastErrorCode: null,
            }
          : { lastErrorCode: CLEANUP_FAILED_CODE },
        select: SAFE_CONNECTION_SELECT,
      });
      const connection = rows[0];
      if (!connection) return null;
      await this.recordAudit(
        transaction,
        { tenantId: snapshot.tenantId, userId },
        cleanupSucceeded ? 'INSTAGRAM_DISCONNECTED' : 'INSTAGRAM_CLEANUP_FAILED',
        cleanupSucceeded ? 'SUCCESS' : 'FAILURE',
        cleanupSucceeded ? undefined : CLEANUP_FAILED_CODE,
      );
      return connection;
    }, { isolationLevel: 'Serializable' }));
    if (finalized) return toSummary(finalized);

    const current = await this.prisma.instagramConnection.findUnique({
      where: { tenantId: snapshot.tenantId },
      select: SAFE_CONNECTION_SELECT,
    });
    return current ? toSummary(current) : emptySummary();
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
          lastErrorCode,
        );
      });
    } catch {
      // A superseded attempt must not change the current connection.
      await this.recordAuditBestEffort(
        binding,
        'INSTAGRAM_CALLBACK_FAILED',
        'FAILURE',
        lastErrorCode,
      );
    }
  }

  private recordAudit(
    client: Prisma.TransactionClient | PrismaClient,
    binding: Pick<OAuthBinding, 'tenantId' | 'userId'>,
    action: string,
    result: 'SUCCESS' | 'FAILURE',
    errorCode?: string,
  ): Promise<unknown> {
    return client.securityAuditLog.create({
      data: {
        tenantId: binding.tenantId,
        userId: binding.userId,
        actor: 'USER',
        action,
        result,
        metadata: errorCode === undefined ? {} : { errorCode },
      },
    });
  }

  private async recordAuditBestEffort(
    binding: Pick<OAuthBinding, 'tenantId' | 'userId'>,
    action: string,
    result: 'SUCCESS' | 'FAILURE',
    errorCode?: string,
  ): Promise<void> {
    try {
      await this.recordAudit(this.prisma, binding, action, result, errorCode);
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

function toSummary(connection: SafeConnectionRow, expired = false): InstagramConnectionSummary {
  return {
    status: expired ? 'REAUTH_REQUIRED' : connection.status,
    accountId: connection.externalAccountId,
    username: connection.displayName,
    tokenExpiresAt: connection.tokenExpiresAt?.toISOString() ?? null,
    lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
    lastErrorCode: expired ? 'META_TOKEN_EXPIRED' : connection.lastErrorCode,
  };
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

function emptySummary(): InstagramConnectionSummary {
  return {
    status: 'NOT_CONNECTED',
    accountId: null,
    username: null,
    tokenExpiresAt: null,
    lastVerifiedAt: null,
    lastErrorCode: null,
  };
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

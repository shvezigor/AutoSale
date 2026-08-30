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
const CLEANUP_PERMANENT_FAILURE_CODE = 'META_CLEANUP_PERMANENT_FAILURE';
const CLEANUP_DEAD_LETTERED_CODE = 'META_CLEANUP_DEAD_LETTERED';
export const INSTAGRAM_CLEANUP_ABANDON_CONFIRMATION = 'ABANDON_REMOTE_CLEANUP';
export const INSTAGRAM_CLEANUP_ABANDON_AFTER_ATTEMPTS = 3;
// Meta documents code 10 as a permission-denied Graph error. It is the only
// cleanup failure we currently have enough provider evidence to abandon as
// permanent; all other coded client errors stay retryable unless they are a
// verified revoke of an unusable credential (code 190 below).
const CLEANUP_PERMANENT_PROVIDER_CODES = new Set([10]);
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
  credentialGenerationId: true,
  disconnectedAt: true,
} as const;

const CLEANUP_ROW_SELECT = {
  id: true,
  credentialGenerationId: true,
  tenantId: true,
  externalAccountId: true,
  encryptedAccessToken: true,
  source: true,
  state: true,
  callbackResolvedAt: true,
  unsubscribeStatus: true,
  revokeStatus: true,
  attempts: true,
  leaseId: true,
  leaseExpiresAt: true,
  version: true,
  lastErrorCode: true,
  permanentFailureAt: true,
  deadLetteredAt: true,
  deadLetteredByUserId: true,
  terminalAt: true,
  createdAt: true,
} as const;

const CLEANUP_SUMMARY_SELECT = {
  unsubscribeStatus: true,
  revokeStatus: true,
  attempts: true,
  leaseId: true,
  leaseExpiresAt: true,
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
type CleanupState = 'ARMED' | 'REQUIRED' | 'COMPLETED' | 'CANCELLED' | 'DEAD_LETTER';
type CleanupPublicStatus = 'NONE' | 'PENDING' | 'FAILED';
type CleanupOperation = 'UNSUBSCRIBE' | 'REVOKE';
type CleanupSource = 'DISCONNECT' | 'CALLBACK_COMPENSATION' | 'SUBSCRIPTION_FAILURE';
type CleanupFailureResolution = 'SUCCEEDED' | 'RETRYABLE' | 'PERMANENT';

type CleanupSummary = {
  status: CleanupPublicStatus;
  errorCode: string | null;
  abandonEligible: boolean;
};

type CleanupSummaryRow = {
  unsubscribeStatus: CleanupOperationStatus;
  revokeStatus: CleanupOperationStatus;
  attempts: number;
  leaseId: string | null;
  leaseExpiresAt: Date | null;
  lastErrorCode: string | null;
};

type CleanupRow = {
  id: string;
  credentialGenerationId: string;
  tenantId: string;
  externalAccountId: string;
  encryptedAccessToken: string;
  source: string;
  state: CleanupState;
  callbackResolvedAt: Date | null;
  unsubscribeStatus: CleanupOperationStatus;
  revokeStatus: CleanupOperationStatus;
  attempts: number;
  leaseId: string | null;
  leaseExpiresAt: Date | null;
  version: number;
  lastErrorCode: string | null;
  permanentFailureAt: Date | null;
  deadLetteredAt: Date | null;
  deadLetteredByUserId: string | null;
  terminalAt: Date | null;
  createdAt: Date;
};

type LeasedCleanupRow = CleanupRow & {
  leaseId: string;
  leaseExpiresAt: Date;
};

type PendingCredential = {
  credentialGenerationId: string;
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
  cleanupAbandonEligible: boolean;
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
      credentialGenerationId: randomUUID(),
      externalAccountId: identity.accountId,
      encryptedAccessToken: this.cipher.encrypt(accessToken),
    };
    const pendingData = {
      externalAccountId: identity.accountId,
      displayName: identity.username,
      status: 'ERROR' as const,
      encryptedAccessToken: pendingCredential.encryptedAccessToken,
      credentialGenerationId: pendingCredential.credentialGenerationId,
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
        await transaction.instagramCredentialCleanup.create({
          data: {
            credentialGenerationId: pendingCredential.credentialGenerationId,
            tenantId: binding.tenantId,
            externalAccountId: pendingCredential.externalAccountId,
            encryptedAccessToken: pendingCredential.encryptedAccessToken,
            source: 'CALLBACK_PREARM',
            state: 'ARMED',
            callbackResolvedAt: null,
          },
          select: CLEANUP_ROW_SELECT,
        });
        await this.recordAudit(
          transaction,
          binding,
          'INSTAGRAM_CREDENTIAL_CLEANUP_QUEUED',
          'SUCCESS',
        );
      });
    } catch {
      // A concurrent unique-account claim must never overwrite the owning tenant.
      await this.markCallbackFailure(binding, 'ERROR', 'META_CONNECTION_FAILED');
      throw safeFailure();
    }

    try {
      await this.meta.subscribe(accessToken);
    } catch {
      try {
        const cleanup = await this.requireCallbackCleanup(
          binding,
          pendingCredential,
          'SUBSCRIPTION_FAILURE',
          'META_SUBSCRIPTION_FAILED',
        );
        await this.cleanupCredentialById(cleanup.id, binding.userId);
      } finally {
        // Even if a transient cleanup persistence/read failure prevents the
        // inline retry, keep the callback outcome safe and auditable. The
        // pre-armed row remains the durable recovery record.
        await this.markCallbackFailure(binding, 'ERROR', 'META_SUBSCRIPTION_FAILED');
      }
      throw safeFailure();
    }

    let active: SafeConnectionRow;
    try {
      active = await this.withCurrentAttempt(binding, async (transaction) => {
        if (pendingData.tokenExpiresAt <= this.now()) throw safeFailure();
        const resolvedCleanup = await transaction.instagramCredentialCleanup.updateMany({
          where: {
            credentialGenerationId: pendingCredential.credentialGenerationId,
            state: 'ARMED',
            terminalAt: null,
          },
          data: {
            state: 'CANCELLED',
            callbackResolvedAt: connectedAt,
            terminalAt: connectedAt,
            lastErrorCode: null,
            leaseId: null,
            leaseExpiresAt: null,
            version: { increment: 1 },
          },
        });
        if (resolvedCleanup.count !== 1) throw safeFailure();
        const connection = await transaction.instagramConnection.update({
          where: { tenantId: binding.tenantId },
          data: {
            status: 'ACTIVE',
            lastVerifiedAt: connectedAt,
            lastErrorCode: null,
            disconnectedAt: null,
          },
          select: SAFE_CONNECTION_SELECT,
        });
        await this.recordAudit(transaction, binding, 'INSTAGRAM_CONNECTED', 'SUCCESS');
        return connection;
      });
    } catch {
      try {
        const cleanup = await this.requireCallbackCleanup(
          binding,
          pendingCredential,
          'CALLBACK_COMPENSATION',
          'META_ACTIVATION_FAILED',
        );
        await this.cleanupCredentialById(cleanup.id, binding.userId);
      } finally {
        await this.recordAuditBestEffort(binding, 'INSTAGRAM_CALLBACK_FAILED', 'FAILURE', { errorCode: 'META_ACTIVATION_FAILED' });
      }
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
    await this.recoverUnresolvedCleanups(tenantId);
    await this.cleanupAvailableCredentials(tenantId, userId);
    return this.getSummary(tenantId);
  }

  async deadLetterCleanup(
    tenantId: string,
    userId: string,
    confirmation: string,
  ): Promise<InstagramConnectionSummary> {
    if (confirmation !== INSTAGRAM_CLEANUP_ABANDON_CONFIRMATION) throw safeFailure();
    await this.withSerializableRetry(() => this.prisma.$transaction(async (transaction) => {
      const failed = await transaction.instagramCredentialCleanup.findMany({
        where: { tenantId, terminalAt: null },
        select: {
          id: true,
          credentialGenerationId: true,
          permanentFailureAt: true,
          unsubscribeStatus: true,
          revokeStatus: true,
          attempts: true,
          leaseId: true,
          leaseExpiresAt: true,
        },
      });
      const eligible = failed.filter((cleanup) =>
        cleanup.permanentFailureAt !== null || isCleanupAbandonEligible(cleanup));
      if (eligible.length === 0) throw safeFailure();

      const deadLetteredAt = this.now();
      const generations: string[] = [];
      let permanentDeadLettered = false;
      let retryableDeadLettered = false;
      for (const cleanup of eligible) {
        const firstOperation = firstIncompleteOperation(cleanup);
        const operationWhere = cleanup.permanentFailureAt !== null
          ? { permanentFailureAt: { not: null } }
          : firstOperation === 'UNSUBSCRIBE'
            ? { unsubscribeStatus: 'FAILED' as const }
            : { unsubscribeStatus: 'SUCCEEDED' as const, revokeStatus: 'FAILED' as const };
        const attemptWhere = cleanup.permanentFailureAt === null
          ? { attempts: { gte: INSTAGRAM_CLEANUP_ABANDON_AFTER_ATTEMPTS } }
          : {};
        const updated = await transaction.instagramCredentialCleanup.updateMany({
          where: {
            id: cleanup.id,
            state: 'REQUIRED',
            terminalAt: null,
            leaseId: null,
            leaseExpiresAt: null,
            ...attemptWhere,
            ...operationWhere,
          },
          data: {
            state: 'DEAD_LETTER',
            terminalAt: deadLetteredAt,
            deadLetteredAt,
            deadLetteredByUserId: userId,
            lastErrorCode: CLEANUP_DEAD_LETTERED_CODE,
            leaseId: null,
            leaseExpiresAt: null,
            version: { increment: 1 },
          },
        });
        if (updated.count === 1) {
          generations.push(cleanup.credentialGenerationId);
          if (cleanup.permanentFailureAt !== null) permanentDeadLettered = true;
          else retryableDeadLettered = true;
        }
      }
      if (generations.length === 0) throw safeFailure();

      await transaction.instagramConnection.updateMany({
        where: {
          tenantId,
          status: 'DISCONNECTED',
          credentialGenerationId: { in: generations },
        },
        data: { lastErrorCode: CLEANUP_DEAD_LETTERED_CODE },
      });
      await this.recordAudit(
        transaction,
        { tenantId, userId },
        'INSTAGRAM_CREDENTIAL_CLEANUP_DEAD_LETTERED',
        'SUCCESS',
        {
          errorCode: permanentDeadLettered && retryableDeadLettered
            ? CLEANUP_DEAD_LETTERED_CODE
            : permanentDeadLettered
              ? CLEANUP_PERMANENT_FAILURE_CODE
              : CLEANUP_FAILED_CODE,
        },
      );
    }, { isolationLevel: 'Serializable' }));
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
        const existingCleanup = connection.credentialGenerationId === null
          ? null
          : await transaction.instagramCredentialCleanup.findUnique({
            where: { credentialGenerationId: connection.credentialGenerationId },
            select: CLEANUP_ROW_SELECT,
          });
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
        if (existingCleanup?.terminalAt === null) return existingCleanup.id;
        await this.recordAudit(
          transaction,
          { tenantId, userId },
          'INSTAGRAM_DISCONNECTED',
          'SUCCESS',
        );
        return null;
      }

      const credentialGenerationId = connection.credentialGenerationId ?? randomUUID();
      const existingCleanup = await transaction.instagramCredentialCleanup.findUnique({
        where: { credentialGenerationId },
        select: CLEANUP_ROW_SELECT,
      });
      await transaction.instagramConnection.update({
        where: { id: connection.id },
        data: {
          status: 'DISCONNECTED',
          encryptedAccessToken: null,
          credentialGenerationId,
          tokenExpiresAt: null,
          grantedScopes: null,
          disconnectedAt,
          lastErrorCode: null,
        },
        select: SAFE_CONNECTION_SELECT,
      });
      const cleanup = existingCleanup === null
        ? await transaction.instagramCredentialCleanup.create({
          data: {
            credentialGenerationId,
            tenantId,
            externalAccountId: connection.externalAccountId,
            encryptedAccessToken: connection.encryptedAccessToken,
            source: 'DISCONNECT',
            state: 'REQUIRED',
            callbackResolvedAt: disconnectedAt,
          },
          select: CLEANUP_ROW_SELECT,
        })
        : (await transaction.instagramCredentialCleanup.updateManyAndReturn({
          where: { credentialGenerationId },
          data: {
            // A pre-armed row has to remain unresolved until the callback has
            // finished its in-flight subscribe call. For an already-required
            // row, retain operation progress and any active lease; disconnect
            // must reuse the generation rather than reset or duplicate it.
            source: existingCleanup.source === 'CALLBACK_PREARM' ? 'DISCONNECT' : existingCleanup.source,
            state: 'REQUIRED',
            terminalAt: null,
            ...(existingCleanup.terminalAt !== null
              ? {
                unsubscribeStatus: 'PENDING' as const,
                unsubscribeAttemptedAt: null,
                unsubscribeSucceededAt: null,
                revokeStatus: 'PENDING' as const,
                revokeAttemptedAt: null,
                revokeSucceededAt: null,
                lastErrorCode: null,
                permanentFailureAt: null,
                deadLetteredAt: null,
                deadLetteredByUserId: null,
                leaseId: null,
                leaseExpiresAt: null,
              }
              : {}),
            version: { increment: 1 },
          },
          select: CLEANUP_ROW_SELECT,
        }))[0];
      if (!cleanup) throw safeFailure();
      await this.recordAudit(
        transaction,
        { tenantId, userId },
        'INSTAGRAM_CREDENTIAL_CLEANUP_QUEUED',
        'SUCCESS',
      );
      return cleanup.id;
    }, { isolationLevel: 'Serializable' }));
  }

  private async requireCallbackCleanup(
    binding: OAuthBinding,
    credential: PendingCredential,
    source: Exclude<CleanupSource, 'DISCONNECT'>,
    lastErrorCode: string,
  ): Promise<CleanupRow> {
    const cleanup = await this.withSerializableRetry(() => this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.instagramCredentialCleanup.findUnique({
        where: { credentialGenerationId: credential.credentialGenerationId },
        select: CLEANUP_ROW_SELECT,
      });
      if (!existing) throw safeFailure();

      // Cleanup may have recovered and completed while the callback was
      // unwinding. Never resurrect a terminal generation or replay its remote
      // effects merely because the losing callback noticed its stale attempt.
      if (existing.terminalAt !== null) return existing;

      const resolvedAt = existing.callbackResolvedAt ?? this.now();
      const rows = await transaction.instagramCredentialCleanup.updateManyAndReturn({
        where: {
          credentialGenerationId: credential.credentialGenerationId,
          tenantId: binding.tenantId,
          terminalAt: null,
          state: { in: ['ARMED', 'REQUIRED'] },
        },
        data: {
          // Disconnect wins the callback/disconnect race and owns the reason
          // for the single generation row. Preserve that source in the late
          // callback path; otherwise record the callback's failure source.
          source: existing.source === 'DISCONNECT' ? existing.source : source,
          state: 'REQUIRED',
          callbackResolvedAt: resolvedAt,
          lastErrorCode,
          version: { increment: 1 },
        },
        select: CLEANUP_ROW_SELECT,
      });
      const row = rows[0];
      if (!row) throw safeFailure();
      await transaction.instagramConnection.updateMany({
        where: {
          tenantId: binding.tenantId,
          credentialGenerationId: credential.credentialGenerationId,
          status: { not: 'ACTIVE' },
        },
        data: {
          encryptedAccessToken: null,
          tokenExpiresAt: null,
          grantedScopes: null,
          lastErrorCode,
        },
      });
      return row ?? existing;
    }, { isolationLevel: 'Serializable' }));
    if (cleanup.terminalAt === null) {
      await this.recordAuditBestEffort(
        binding,
        'INSTAGRAM_CREDENTIAL_CLEANUP_QUEUED',
        'SUCCESS',
        { errorCode: lastErrorCode },
      );
    }
    return cleanup;
  }

  private async recoverUnresolvedCleanups(tenantId: string): Promise<void> {
    const recoveredAt = this.now();
    const staleBefore = new Date(recoveredAt.getTime() - CLEANUP_LEASE_MS);
    await this.withSerializableRetry(() => this.prisma.$transaction(async (transaction) => {
      const unresolved = await transaction.instagramCredentialCleanup.findMany({
        where: {
          tenantId,
          terminalAt: null,
          callbackResolvedAt: null,
          createdAt: { lt: staleBefore },
          state: { in: ['ARMED', 'REQUIRED'] },
        },
        select: { credentialGenerationId: true },
      });
      const generations = unresolved.map((row) => row.credentialGenerationId);
      if (generations.length === 0) return;

      await transaction.instagramCredentialCleanup.updateMany({
        where: {
          credentialGenerationId: { in: generations },
          tenantId,
          terminalAt: null,
          callbackResolvedAt: null,
          state: { in: ['ARMED', 'REQUIRED'] },
        },
        data: {
          source: 'OPERATOR_RECOVERY',
          state: 'REQUIRED',
          callbackResolvedAt: recoveredAt,
          lastErrorCode: null,
          version: { increment: 1 },
        },
      });
      await transaction.instagramConnection.updateMany({
        where: {
          tenantId,
          credentialGenerationId: { in: generations },
          status: { not: 'ACTIVE' },
        },
        data: {
          encryptedAccessToken: null,
          tokenExpiresAt: null,
          grantedScopes: null,
          lastErrorCode: 'META_ACTIVATION_FAILED',
        },
      });
    }, { isolationLevel: 'Serializable' }));
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
    if (!row || row.terminalAt !== null || row.state !== 'REQUIRED' || row.callbackResolvedAt === null) return null;
    return this.leaseCleanupRow(row);
  }

  private async leaseNextCleanup(tenantId: string, excludedIds: string[]): Promise<LeasedCleanupRow | null> {
    const checkedAt = this.now();
    const row = await this.prisma.instagramCredentialCleanup.findFirst({
      where: {
        tenantId,
        state: 'REQUIRED',
        callbackResolvedAt: { not: null },
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
        state: 'REQUIRED',
        callbackResolvedAt: { not: null },
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

    const operation = firstIncompleteOperation(cleanup);
    if (operation === null) {
      await this.markCleanupCompleted(cleanup, userId);
      return;
    }

    let accessToken: string;
    try {
      accessToken = this.cipher.decrypt(cleanup.encryptedAccessToken);
    } catch {
      await this.markCleanupFailed(cleanup, operation, userId, false);
      return;
    }

    let current = cleanup;
    if (current.unsubscribeStatus !== 'SUCCEEDED') {
      const attempted = await this.markCleanupAttempt(current, 'UNSUBSCRIBE');
      if (!attempted) return;
      current = attempted;
      try {
        await this.meta.unsubscribe(accessToken);
      } catch (error) {
        const resolution = classifyCleanupFailure('UNSUBSCRIBE', error);
        if (resolution !== 'SUCCEEDED') {
          await this.markCleanupFailed(current, 'UNSUBSCRIBE', userId, resolution === 'PERMANENT');
          return;
        }
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
      } catch (error) {
        const resolution = classifyCleanupFailure('REVOKE', error);
        if (resolution !== 'SUCCEEDED') {
          await this.markCleanupFailed(current, 'REVOKE', userId, resolution === 'PERMANENT');
          return;
        }
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
      ? { unsubscribeStatus: 'PENDING', unsubscribeAttemptedAt: attemptedAt, lastErrorCode: null, permanentFailureAt: null }
      : { revokeStatus: 'PENDING', revokeAttemptedAt: attemptedAt, lastErrorCode: null, permanentFailureAt: null });
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
    permanent: boolean,
  ): Promise<void> {
    const failedAt = this.now();
    const failed = await this.updateLeasedCleanup(cleanup, {
      ...(operation === 'UNSUBSCRIBE'
        ? { unsubscribeStatus: 'FAILED', unsubscribeAttemptedAt: failedAt }
        : { revokeStatus: 'FAILED', revokeAttemptedAt: failedAt }),
      lastErrorCode: permanent ? CLEANUP_PERMANENT_FAILURE_CODE : CLEANUP_FAILED_CODE,
      permanentFailureAt: permanent ? failedAt : null,
      leaseId: null,
      leaseExpiresAt: null,
    });
    if (!failed) return;
    await this.recordAuditBestEffort(
      { tenantId: cleanup.tenantId, userId },
      'INSTAGRAM_CREDENTIAL_CLEANUP_FAILED',
      'FAILURE',
      { errorCode: permanent ? CLEANUP_PERMANENT_FAILURE_CODE : CLEANUP_FAILED_CODE },
    );
  }

  private async markCleanupCompleted(cleanup: LeasedCleanupRow, userId: string): Promise<void> {
    if (cleanup.callbackResolvedAt === null) {
      await this.updateLeasedCleanup(cleanup, { leaseId: null, leaseExpiresAt: null });
      return;
    }

    const completedAt = this.now();
    const completed = await this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.instagramCredentialCleanup.updateManyAndReturn({
        where: {
          id: cleanup.id,
          leaseId: cleanup.leaseId,
          version: cleanup.version,
          state: 'REQUIRED',
          terminalAt: null,
        },
        data: {
          state: 'COMPLETED',
          terminalAt: completedAt,
          lastErrorCode: null,
          permanentFailureAt: null,
          leaseId: null,
          leaseExpiresAt: null,
          version: { increment: 1 },
        },
        select: CLEANUP_ROW_SELECT,
      });
      const row = rows[0];
      if (!row) return { row: null, disconnected: false };
      const connection = await transaction.instagramConnection.updateMany({
        where: {
          tenantId: cleanup.tenantId,
          credentialGenerationId: cleanup.credentialGenerationId,
          status: 'DISCONNECTED',
        },
        data: { lastErrorCode: null },
      });
      return { row, disconnected: connection.count === 1 };
    });
    if (!completed.row) return;
    await this.recordAuditBestEffort(
      { tenantId: cleanup.tenantId, userId },
      'INSTAGRAM_CREDENTIAL_CLEANUP_COMPLETED',
      'SUCCESS',
    );
    if (completed.disconnected) {
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
        state: 'REQUIRED',
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
    cleanupAbandonEligible: cleanup.abandonEligible,
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
    cleanupAbandonEligible: cleanup.abandonEligible,
  };
}

function summarizeCleanup(rows: CleanupSummaryRow[]): CleanupSummary {
  if (rows.length === 0) return noCleanup();
  const failed = rows.find((row) =>
    row.lastErrorCode !== null ||
    row.unsubscribeStatus === 'FAILED' ||
    row.revokeStatus === 'FAILED');
  const abandonEligible = rows.some((row) => isCleanupAbandonEligible(row));
  if (failed) return { status: 'FAILED', errorCode: failed.lastErrorCode ?? CLEANUP_FAILED_CODE, abandonEligible };
  return { status: 'PENDING', errorCode: null, abandonEligible };
}

function noCleanup(): CleanupSummary {
  return { status: 'NONE', errorCode: null, abandonEligible: false };
}

function asLeasedCleanup(row: CleanupRow | undefined | null): LeasedCleanupRow | null {
  if (!row || row.leaseId === null || row.leaseExpiresAt === null) return null;
  return { ...row, leaseId: row.leaseId, leaseExpiresAt: row.leaseExpiresAt };
}

function firstIncompleteOperation(
  cleanup: Pick<CleanupRow, 'unsubscribeStatus' | 'revokeStatus'>,
): CleanupOperation | null {
  if (cleanup.unsubscribeStatus !== 'SUCCEEDED') return 'UNSUBSCRIBE';
  if (cleanup.revokeStatus !== 'SUCCEEDED') return 'REVOKE';
  return null;
}

function isCleanupAbandonEligible(
  cleanup: Pick<CleanupSummaryRow, 'unsubscribeStatus' | 'revokeStatus' | 'attempts' | 'leaseId' | 'leaseExpiresAt'>,
): boolean {
  const operation = firstIncompleteOperation(cleanup);
  const operationFailed = operation === 'UNSUBSCRIBE'
    ? cleanup.unsubscribeStatus === 'FAILED'
    : operation === 'REVOKE'
      ? cleanup.revokeStatus === 'FAILED'
      : false;
  return operationFailed &&
    cleanup.attempts >= INSTAGRAM_CLEANUP_ABANDON_AFTER_ATTEMPTS &&
    cleanup.leaseId === null &&
    cleanup.leaseExpiresAt === null;
}

function classifyCleanupFailure(operation: CleanupOperation, error: unknown): CleanupFailureResolution {
  if (!(error instanceof MetaInstagramError)) return 'RETRYABLE';
  if (error.isTransient === true) return 'RETRYABLE';
  if (operation === 'REVOKE' && isInvalidCredential(error)) return 'SUCCEEDED';
  if (isEvidenceBackedPermanentFailure(error)) return 'PERMANENT';
  return 'RETRYABLE';
}

function isEvidenceBackedPermanentFailure(error: MetaInstagramError): boolean {
  if (error.status === null || error.status < 400 || error.status >= 500) return false;
  const providerCode = typeof error.providerCode === 'number'
    ? error.providerCode
    : typeof error.providerCode === 'string' && /^\d+$/.test(error.providerCode)
      ? Number(error.providerCode)
      : null;
  return providerCode !== null && CLEANUP_PERMANENT_PROVIDER_CODES.has(providerCode);
}

function isInvalidCredential(error: MetaInstagramError): boolean {
  return (error.status === 400 || error.status === 401) && String(error.providerCode) === '190';
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

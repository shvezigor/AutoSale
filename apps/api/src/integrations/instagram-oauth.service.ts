import type { PrismaClient } from '@autosale/database';
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
  ): Promise<{ returnPath: string; summary: InstagramConnectionSummary }> {
    let binding: { tenantId: string; userId: string; returnPath: string };
    try {
      binding = await this.states.consume(rawState);
    } catch {
      throw safeFailure();
    }

    if (!await this.hasActiveOwner(binding.tenantId, binding.userId)) {
      throw safeFailure();
    }

    if (!code) {
      await this.markFailure(binding.tenantId, 'ERROR', 'META_CALLBACK_INVALID');
      throw safeFailure();
    }

    let accessToken: string;
    let expiresIn: number | null;
    let identity: { accountId: string; username: string | null };
    let grantedScopes: string[];
    try {
      const token = await this.meta.exchangeCode({ code, redirectUri: this.callbackUri });
      accessToken = token.accessToken;
      expiresIn = token.expiresIn;
      identity = await this.meta.getIdentity(accessToken);
      grantedScopes = await this.meta.getGrantedScopes(accessToken);
    } catch (error) {
      const authorizationFailure = isAuthorizationFailure(error);
      await this.markFailure(
        binding.tenantId,
        authorizationFailure ? 'REAUTH_REQUIRED' : 'ERROR',
        authorizationFailure ? 'META_AUTHORIZATION_FAILED' : 'META_PROVIDER_FAILED',
      );
      throw safeFailure();
    }

    if (!hasRequiredScopes(grantedScopes)) {
      await this.markFailure(binding.tenantId, 'ERROR', 'META_REQUIRED_SCOPES_MISSING');
      throw safeFailure();
    }

    const owner = await this.prisma.instagramConnection.findUnique({
      where: { externalAccountId: identity.accountId },
      select: { tenantId: true },
    });
    if (owner && owner.tenantId !== binding.tenantId) {
      throw safeFailure();
    }

    const connectedAt = this.now();
    const pendingData = {
      externalAccountId: identity.accountId,
      displayName: identity.username,
      status: 'ERROR' as const,
      encryptedAccessToken: this.cipher.encrypt(accessToken),
      tokenExpiresAt: expiresIn === null ? null : new Date(connectedAt.getTime() + expiresIn * 1000),
      grantedScopes: grantedScopes.join(','),
      lastVerifiedAt: null,
      lastErrorCode: null,
      connectedByUserId: binding.userId,
      disconnectedAt: null,
    };

    try {
      await this.prisma.instagramConnection.upsert({
        where: { tenantId: binding.tenantId },
        create: { tenantId: binding.tenantId, ...pendingData },
        update: pendingData,
      });
    } catch {
      // A concurrent unique-account claim must never overwrite the owning tenant.
      throw safeFailure();
    }

    try {
      await this.meta.subscribe(accessToken);
    } catch {
      await this.prisma.instagramConnection.update({
        where: { tenantId: binding.tenantId },
        data: { status: 'ERROR', lastErrorCode: 'META_SUBSCRIPTION_FAILED' },
      });
      throw safeFailure();
    }

    let active: SafeConnectionRow;
    try {
      active = await this.prisma.instagramConnection.update({
        where: { tenantId: binding.tenantId },
        data: {
          status: 'ACTIVE',
          lastVerifiedAt: connectedAt,
          lastErrorCode: null,
          disconnectedAt: null,
        },
        select: SAFE_CONNECTION_SELECT,
      });
    } catch {
      throw safeFailure();
    }

    return { returnPath: binding.returnPath, summary: toSummary(active) };
  }

  async disconnect(tenantId: string): Promise<InstagramConnectionSummary> {
    const connection = await this.prisma.instagramConnection.findUnique({
      where: { tenantId },
      select: { encryptedAccessToken: true },
    });
    if (!connection) return emptySummary();

    const disconnectedAt = this.now();
    const disabled = await this.prisma.instagramConnection.update({
      where: { tenantId },
      data: connection.encryptedAccessToken
        ? {
            status: 'DISCONNECTED',
            disconnectedAt,
            lastErrorCode: null,
          }
        : {
            status: 'DISCONNECTED',
            encryptedAccessToken: null,
            tokenExpiresAt: null,
            grantedScopes: null,
            disconnectedAt,
            lastErrorCode: null,
          },
      select: SAFE_CONNECTION_SELECT,
    });

    if (!connection.encryptedAccessToken) return toSummary(disabled);

    let cleanupSucceeded = false;
    try {
      const accessToken = this.cipher.decrypt(connection.encryptedAccessToken);
      const cleanup = await Promise.allSettled([
        this.meta.unsubscribe(accessToken),
        this.meta.revoke(accessToken),
      ]);
      cleanupSucceeded = cleanup.every((result) => result.status === 'fulfilled');
    } catch {
      cleanupSucceeded = false;
    }

    const finalized = await this.prisma.instagramConnection.update({
      where: { tenantId },
      data: cleanupSucceeded
        ? {
            encryptedAccessToken: null,
            tokenExpiresAt: null,
            grantedScopes: null,
            lastErrorCode: null,
          }
        : { status: 'DISCONNECTED', lastErrorCode: 'META_DISCONNECT_CLEANUP_FAILED' },
      select: SAFE_CONNECTION_SELECT,
    });

    return toSummary(finalized);
  }

  private async markFailure(
    tenantId: string,
    status: 'REAUTH_REQUIRED' | 'ERROR',
    lastErrorCode: string,
  ): Promise<void> {
    try {
      await this.prisma.instagramConnection.updateMany({
        where: { tenantId },
        data: { status, lastErrorCode },
      });
    } catch {
      // The public callback still returns only the normalized failure.
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

function safeFailure(): Error {
  return new Error(SAFE_FAILURE_MESSAGE);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

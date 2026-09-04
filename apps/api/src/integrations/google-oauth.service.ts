import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@autosale/database';

import { CredentialCipher } from './credential-cipher.js';
import type { GoogleOAuthClientPort } from './google-oauth.client.js';
import { GoogleOAuthStateService } from './google-oauth-state.service.js';
import { NotificationService } from '../notifications/notifications.service.js';

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SAFE_FAILURE = 'Google connection failed';

export type GoogleConnectionSummary = {
  status: 'NOT_CONNECTED' | 'ACTIVE' | 'REAUTHORIZATION_REQUIRED' | 'DISCONNECTING' | 'ERROR' | 'DISCONNECTED';
  email: string | null;
  grantedScopes: string[];
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
};

export class GoogleOAuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly client: GoogleOAuthClientPort,
    private readonly states: GoogleOAuthStateService,
    private readonly cipher: CredentialCipher,
    private readonly now: () => Date = () => new Date(),
    private readonly notifications?: NotificationService,
  ) {}

  async start(tenantId: string, userId: string, returnPath?: string): Promise<{ authorizationUrl: string }> {
    const { state } = await this.states.createAttempt({ tenantId, userId, ...(returnPath === undefined ? {} : { returnPath }) });
    return { authorizationUrl: this.client.getAuthorizationUrl({ state, accessType: 'offline' }) };
  }

  async complete(input: { code?: string; state: string; denied?: boolean }): Promise<{ returnPath: string; summary: GoogleConnectionSummary }> {
    let binding: Awaited<ReturnType<GoogleOAuthStateService['consumeAttempt']>>;
    try {
      binding = await this.states.consumeAttempt(input.state);
    } catch {
      throw new Error(SAFE_FAILURE);
    }

    const owner = await this.prisma.tenantMembership.findFirst({
      where: { tenantId: binding.tenantId, userId: binding.userId, role: 'OWNER', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!owner || input.denied || !input.code) throw new Error(SAFE_FAILURE);

    try {
      const token = await this.client.exchangeCode(input.code);
      if (!token.grantedScopes.includes(DRIVE_FILE_SCOPE)) throw new Error('Required Google scope missing');
      const existing = await this.prisma.googleConnection.findUnique({ where: { tenantId: binding.tenantId } });
      let encryptedRefreshToken: string;
      if (token.refreshToken) {
        encryptedRefreshToken = this.cipher.encrypt(token.refreshToken);
      } else if (existing?.googleSubject === token.subject && existing.encryptedRefreshToken) {
        encryptedRefreshToken = existing.encryptedRefreshToken;
      } else {
        throw new Error('Google refresh token missing');
      }

      const checkedAt = this.now();
      await this.prisma.googleConnection.upsert({
        where: { tenantId: binding.tenantId },
        create: {
          tenantId: binding.tenantId,
          googleSubject: token.subject,
          accountEmail: token.email,
          status: 'ACTIVE',
          encryptedRefreshToken,
          credentialGenerationId: randomUUID(),
          grantedScopes: token.grantedScopes.join(' '),
          connectedByUserId: binding.userId,
          lastVerifiedAt: checkedAt,
        },
        update: {
          googleSubject: token.subject,
          accountEmail: token.email,
          status: 'ACTIVE',
          encryptedRefreshToken,
          credentialGenerationId: randomUUID(),
          grantedScopes: token.grantedScopes.join(' '),
          connectedByUserId: binding.userId,
          lastVerifiedAt: checkedAt,
          lastErrorCode: null,
          disconnectedAt: null,
        },
      });
      await this.audit(binding.tenantId, binding.userId, 'GOOGLE_CONNECT_COMPLETED', 'SUCCESS');
      return { returnPath: binding.returnPath, summary: await this.summary(binding.tenantId) };
    } catch {
      await this.audit(binding.tenantId, binding.userId, 'GOOGLE_CONNECT_FAILED', 'FAILURE');
      await this.notify({ tenantId: binding.tenantId, userId: binding.userId, type: 'ERROR', category: 'GOOGLE_REAUTHORIZATION_REQUIRED', title: 'Google потребує повторного підключення', actionUrl: '/settings?tab=google' });
      throw new Error(SAFE_FAILURE);
    }
  }

  async summary(tenantId: string, includePrivateAccount = true): Promise<GoogleConnectionSummary> {
    const connection = await this.prisma.googleConnection.findUnique({
      where: { tenantId },
      select: { status: true, accountEmail: true, grantedScopes: true, createdAt: true, lastVerifiedAt: true, lastErrorCode: true },
    });
    if (!connection) return { status: 'NOT_CONNECTED', email: null, grantedScopes: [], connectedAt: null, lastVerifiedAt: null, lastErrorCode: null };
    return {
      status: connection.status,
      email: includePrivateAccount ? connection.accountEmail : null,
      grantedScopes: includePrivateAccount ? connection.grantedScopes?.split(/\s+/).filter(Boolean) ?? [] : [],
      connectedAt: connection.createdAt.toISOString(),
      lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
      lastErrorCode: connection.lastErrorCode,
    };
  }

  async getAccessToken(tenantId: string): Promise<string> {
    const connection = await this.prisma.googleConnection.findUnique({
      where: { tenantId },
      select: { status: true, encryptedRefreshToken: true, credentialGenerationId: true, connectedByUserId: true },
    });
    if (connection?.status !== 'ACTIVE' || !connection.encryptedRefreshToken || !connection.credentialGenerationId) {
      throw new Error(SAFE_FAILURE);
    }
    try {
      return await this.client.refreshAccessToken(this.cipher.decrypt(connection.encryptedRefreshToken));
    } catch {
      await this.prisma.googleConnection.updateMany({
        where: { tenantId, credentialGenerationId: connection.credentialGenerationId },
        data: { status: 'REAUTHORIZATION_REQUIRED', lastErrorCode: 'GOOGLE_TOKEN_REFRESH_FAILED' },
      });
      if (connection.connectedByUserId) await this.notify({ tenantId, userId: connection.connectedByUserId, type: 'WARNING', category: 'GOOGLE_REAUTHORIZATION_REQUIRED', title: 'Потрібно повторно підключити Google', actionUrl: '/settings?tab=google' });
      throw new Error(SAFE_FAILURE);
    }
  }

  private async audit(tenantId: string, userId: string, action: string, result: string): Promise<void> {
    await this.prisma.securityAuditLog.create({ data: { tenantId, userId, actor: 'USER', action, result, metadata: {} } });
  }

  private async notify(input: Parameters<NotificationService['create']>[0]) {
    try { await this.notifications?.create(input); } catch { /* business flow must not fail on notification delivery */ }
  }
}

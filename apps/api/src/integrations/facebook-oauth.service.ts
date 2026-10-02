import { randomUUID } from 'node:crypto';

import type { FacebookConnectionSummary, FacebookPageCandidate, FacebookPageSelectionInput } from '@autosale/contracts/facebook';
import { assertTenantAcceptingMutations, type Prisma, type PrismaClient, withTenantTransaction } from '@autosale/database';
import { MetaFacebookError, type MetaFacebookClient, type MetaFacebookPage } from '@autosale/integrations';

import { CredentialCipher } from './credential-cipher.js';
import { FacebookOAuthStateService, type FacebookOAuthBinding } from './facebook-oauth-state.service.js';

const CALLBACK_PATH = '/api/integrations/facebook/callback';
const CANDIDATE_TTL_MS = 10 * 60 * 1_000;
const CLEANUP_LEASE_MS = 5 * 60 * 1_000;
const SAFE_FAILURE_MESSAGE = 'Facebook connection failed';
const CLEANUP_FAILED_CODE = 'FACEBOOK_DISCONNECT_CLEANUP_FAILED';

const SAFE_CONNECTION_SELECT = {
  externalPageId: true,
  pageName: true,
  status: true,
  tokenExpiresAt: true,
  lastVerifiedAt: true,
  lastErrorCode: true,
} as const;

type SafeConnectionRow = {
  externalPageId: string;
  pageName: string | null;
  status: 'ACTIVE' | 'REAUTH_REQUIRED' | 'ERROR' | 'DISCONNECTED';
  tokenExpiresAt: Date | null;
  lastVerifiedAt: Date | null;
  lastErrorCode: string | null;
};

type StoredPageCandidate = MetaFacebookPage;
type CleanupSummary = { status: 'NONE' | 'PENDING' | 'FAILED'; errorCode: string | null };

export type FacebookCallbackResult =
  | { kind: 'CONNECTED'; returnPath: string; summary: FacebookConnectionSummary }
  | { kind: 'PAGE_SELECTION_REQUIRED'; returnPath: string; attemptId: string; pages: FacebookPageCandidate[] };

export class FacebookOAuthService {
  private readonly callbackUri: string;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly meta: MetaFacebookClient,
    private readonly states: FacebookOAuthStateService,
    private readonly cipher: CredentialCipher,
    appPublicUrl: string,
    private readonly enabled: boolean,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.callbackUri = new URL(CALLBACK_PATH, ensureTrailingSlash(appPublicUrl)).toString();
  }

  async getSummary(tenantId: string): Promise<FacebookConnectionSummary> {
    const [connection, cleanup] = await Promise.all([
      withTenantTransaction(this.prisma, tenantId, (transaction) => transaction.facebookConnection.findUnique({
        where: { tenantId },
        select: SAFE_CONNECTION_SELECT,
      })),
      this.getCleanupSummary(tenantId),
    ]);
    if (!connection) return emptySummary(cleanup);

    const expired = connection.status === 'ACTIVE' &&
      connection.tokenExpiresAt !== null &&
      connection.tokenExpiresAt <= this.now();
    if (expired) {
      await withTenantTransaction(this.prisma, tenantId, (transaction) => transaction.facebookConnection.updateMany({
        where: { tenantId, status: 'ACTIVE', tokenExpiresAt: { lte: this.now() } },
        data: { status: 'REAUTH_REQUIRED', lastErrorCode: 'FACEBOOK_TOKEN_EXPIRED' },
      })).catch(() => undefined);
    }
    return toSummary(connection, cleanup, expired);
  }

  async authorize(tenantId: string, userId: string, returnPath?: string): Promise<{ authorizationUrl: string }> {
    this.assertEnabled();
    await withTenantTransaction(this.prisma, tenantId, (transaction) =>
      assertTenantAcceptingMutations(transaction, tenantId, 'META_INBOUND'));
    const state = await this.states.issue({ tenantId, userId, ...(returnPath === undefined ? {} : { returnPath }) });
    return {
      authorizationUrl: this.meta.getAuthorizationUrl({ state, redirectUri: this.callbackUri }),
    };
  }

  async completeCallback(
    code: string | undefined,
    rawState: string,
    authorizationDenied = false,
  ): Promise<FacebookCallbackResult> {
    this.assertEnabled();
    let binding: FacebookOAuthBinding;
    try {
      binding = await this.states.consume(rawState);
    } catch {
      throw safeFailure();
    }

    if (!await this.hasActiveOwner(binding.tenantId, binding.userId)) {
      await this.auditBestEffort(binding, 'FACEBOOK_CALLBACK_FAILED', 'FAILURE', 'FACEBOOK_OWNER_INVALID');
      throw safeFailure();
    }
    if (authorizationDenied || !code) {
      await this.auditBestEffort(
        binding,
        'FACEBOOK_CALLBACK_FAILED',
        'FAILURE',
        authorizationDenied ? 'FACEBOOK_AUTHORIZATION_DENIED' : 'FACEBOOK_CALLBACK_INVALID',
      );
      throw safeFailure();
    }

    let pages: MetaFacebookPage[];
    try {
      const token = await this.meta.exchangeCode({ code, redirectUri: this.callbackUri });
      pages = await this.meta.listEligiblePages(token.accessToken);
    } catch (error) {
      await this.auditBestEffort(binding, 'FACEBOOK_CALLBACK_FAILED', 'FAILURE', providerFailureCode(error));
      throw safeFailure();
    }
    if (pages.length === 0) {
      await this.auditBestEffort(binding, 'FACEBOOK_CALLBACK_FAILED', 'FAILURE', 'FACEBOOK_NO_ELIGIBLE_PAGE');
      throw safeFailure();
    }
    if (pages.length === 1) {
      const summary = await this.activatePage(binding, pages[0]!);
      return { kind: 'CONNECTED', returnPath: binding.returnPath, summary };
    }

    const candidateExpiresAt = new Date(this.now().getTime() + CANDIDATE_TTL_MS);
    await withTenantTransaction(this.prisma, binding.tenantId, async (transaction) => {
      const updated = await transaction.facebookOAuthAttempt.updateMany({
        where: { id: binding.id, tenantId: binding.tenantId, userId: binding.userId, usedAt: { not: null } },
        data: {
          encryptedPageCandidates: this.cipher.encrypt(JSON.stringify(pages)),
          candidateExpiresAt,
          selectedPageId: null,
        },
      });
      if (updated.count !== 1) throw safeFailure();
      await this.recordAudit(transaction, binding, 'FACEBOOK_PAGE_SELECTION_REQUIRED', 'SUCCESS');
    });

    return {
      kind: 'PAGE_SELECTION_REQUIRED',
      returnPath: binding.returnPath,
      attemptId: binding.id,
      pages: publicCandidates(pages),
    };
  }

  async getPageCandidates(tenantId: string, userId: string, attemptId: string): Promise<{
    attemptId: string;
    pages: FacebookPageCandidate[];
  }> {
    const candidates = await this.readCandidates(tenantId, userId, attemptId);
    return { attemptId, pages: publicCandidates(candidates) };
  }

  async selectPage(
    tenantId: string,
    userId: string,
    input: FacebookPageSelectionInput,
  ): Promise<FacebookConnectionSummary> {
    this.assertEnabled();
    const pages = await this.readCandidates(tenantId, userId, input.attemptId);
    const selected = pages.find((page) => page.pageId === input.pageId);
    if (!selected) throw new Error('FACEBOOK_PAGE_NOT_ELIGIBLE');

    const binding = await withTenantTransaction(this.prisma, tenantId, (transaction) =>
      transaction.facebookOAuthAttempt.findUnique({
        where: { id: input.attemptId },
        select: { id: true, tenantId: true, userId: true, returnPath: true },
      }));
    if (!binding || binding.tenantId !== tenantId || binding.userId !== userId) throw pageSelectionExpired();
    return this.activatePage(binding, selected);
  }

  async disconnect(tenantId: string, userId: string): Promise<FacebookConnectionSummary> {
    const cleanupId = await withTenantTransaction(this.prisma, tenantId, async (transaction) => {
      await assertTenantAcceptingMutations(transaction, tenantId, 'META_INBOUND');
      const connection = await transaction.facebookConnection.findUnique({
        where: { tenantId },
        select: {
          id: true,
          externalPageId: true,
          encryptedPageAccessToken: true,
          credentialGenerationId: true,
        },
      });
      const disconnectedAt = this.now();
      await transaction.facebookOAuthAttempt.updateMany({
        where: { tenantId },
        data: {
          usedAt: disconnectedAt,
          encryptedPageCandidates: null,
          candidateExpiresAt: null,
        },
      });
      if (!connection?.encryptedPageAccessToken || !connection.credentialGenerationId) return null;

      const cleanup = await transaction.facebookCredentialCleanup.upsert({
        where: { credentialGenerationId: connection.credentialGenerationId },
        create: {
          credentialGenerationId: connection.credentialGenerationId,
          tenantId,
          externalPageId: connection.externalPageId,
          encryptedPageAccessToken: connection.encryptedPageAccessToken,
          state: 'REQUIRED',
          source: 'DISCONNECT',
        },
        update: { state: 'REQUIRED', terminalAt: null, lastErrorCode: null },
        select: { id: true },
      });
      await transaction.facebookConnection.update({
        where: { id: connection.id },
        data: {
          status: 'DISCONNECTED',
          encryptedPageAccessToken: null,
          credentialGenerationId: null,
          disconnectedAt,
          lastErrorCode: null,
        },
      });
      await this.recordAudit(transaction, { tenantId, userId }, 'FACEBOOK_DISCONNECT_REQUESTED', 'SUCCESS');
      return cleanup.id;
    });

    if (cleanupId) await this.runCleanup(tenantId, cleanupId);
    return this.getSummary(tenantId);
  }

  async retryCleanup(tenantId: string, userId: string): Promise<FacebookConnectionSummary> {
    const rows = await withTenantTransaction(this.prisma, tenantId, (transaction) =>
      transaction.facebookCredentialCleanup.findMany({
        where: { tenantId, terminalAt: null },
        select: { id: true },
      }));
    for (const row of rows) await this.runCleanup(tenantId, row.id);
    await withTenantTransaction(this.prisma, tenantId, (transaction) =>
      this.recordAudit(transaction, { tenantId, userId }, 'FACEBOOK_CLEANUP_RETRIED', 'SUCCESS'));
    return this.getSummary(tenantId);
  }

  private async activatePage(
    binding: FacebookOAuthBinding,
    candidate: StoredPageCandidate,
  ): Promise<FacebookConnectionSummary> {
    const existingTenantId = await this.resolvePageTenant(candidate.pageId);
    if (existingTenantId && existingTenantId !== binding.tenantId) throw new Error('FACEBOOK_PAGE_ALREADY_CONNECTED');

    let verified: { pageId: string; pageName: string };
    try {
      verified = await this.meta.verifyPage(candidate.pageId, candidate.pageAccessToken);
    } catch {
      await this.clearCandidates(binding.tenantId, binding.id);
      throw safeFailure();
    }

    const activatedAt = this.now();
    const credentialGenerationId = randomUUID();
    const encryptedPageAccessToken = this.cipher.encrypt(candidate.pageAccessToken);
    await withTenantTransaction(this.prisma, binding.tenantId, async (transaction) => {
      await assertTenantAcceptingMutations(transaction, binding.tenantId, 'META_INBOUND');
      const existing = await transaction.facebookConnection.findUnique({
        where: { tenantId: binding.tenantId },
        select: { externalPageId: true, encryptedPageAccessToken: true },
      });
      if (existing?.encryptedPageAccessToken && existing.externalPageId !== candidate.pageId) {
        throw new Error('FACEBOOK_DISCONNECT_REQUIRED');
      }
      await transaction.facebookConnection.upsert({
        where: { tenantId: binding.tenantId },
        create: {
          tenantId: binding.tenantId,
          externalPageId: verified.pageId,
          pageName: verified.pageName,
          status: 'ERROR',
          encryptedPageAccessToken,
          credentialGenerationId,
          tokenExpiresAt: null,
          grantedScopes: 'pages_manage_metadata,pages_messaging,pages_read_engagement,pages_show_list',
          connectedByUserId: binding.userId,
        },
        update: {
          externalPageId: verified.pageId,
          pageName: verified.pageName,
          status: 'ERROR',
          encryptedPageAccessToken,
          credentialGenerationId,
          tokenExpiresAt: null,
          grantedScopes: 'pages_manage_metadata,pages_messaging,pages_read_engagement,pages_show_list',
          connectedByUserId: binding.userId,
          lastErrorCode: null,
          disconnectedAt: null,
        },
      });
      await transaction.facebookCredentialCleanup.create({
        data: {
          credentialGenerationId,
          tenantId: binding.tenantId,
          externalPageId: verified.pageId,
          encryptedPageAccessToken,
          source: 'CALLBACK_PREARM',
          state: 'ARMED',
        },
      });
    });

    try {
      await this.meta.subscribePage(verified.pageId, candidate.pageAccessToken);
    } catch {
      await withTenantTransaction(this.prisma, binding.tenantId, async (transaction) => {
        await transaction.facebookCredentialCleanup.updateMany({
          where: { credentialGenerationId, terminalAt: null },
          data: { state: 'REQUIRED', lastErrorCode: 'FACEBOOK_SUBSCRIPTION_FAILED' },
        });
        await transaction.facebookConnection.updateMany({
          where: { tenantId: binding.tenantId, credentialGenerationId },
          data: { status: 'ERROR', lastErrorCode: 'FACEBOOK_SUBSCRIPTION_FAILED' },
        });
      });
      throw safeFailure();
    }

    const active = await withTenantTransaction(this.prisma, binding.tenantId, async (transaction) => {
      const updatedCleanup = await transaction.facebookCredentialCleanup.updateMany({
        where: { credentialGenerationId, state: 'ARMED', terminalAt: null },
        data: {
          state: 'CANCELLED',
          callbackResolvedAt: activatedAt,
          terminalAt: activatedAt,
          lastErrorCode: null,
          version: { increment: 1 },
        },
      });
      if (updatedCleanup.count !== 1) throw safeFailure();
      const connection = await transaction.facebookConnection.update({
        where: { tenantId: binding.tenantId },
        data: { status: 'ACTIVE', lastVerifiedAt: activatedAt, lastErrorCode: null },
        select: SAFE_CONNECTION_SELECT,
      });
      await transaction.facebookOAuthAttempt.updateMany({
        where: { id: binding.id, tenantId: binding.tenantId },
        data: {
          selectedPageId: verified.pageId,
          encryptedPageCandidates: null,
          candidateExpiresAt: null,
        },
      });
      await this.recordAudit(transaction, binding, 'FACEBOOK_CONNECTED', 'SUCCESS');
      return connection;
    });
    return toSummary(active, noCleanup());
  }

  private async readCandidates(tenantId: string, userId: string, attemptId: string): Promise<StoredPageCandidate[]> {
    const attempt = await withTenantTransaction(this.prisma, tenantId, (transaction) =>
      transaction.facebookOAuthAttempt.findFirst({
        where: {
          id: attemptId,
          tenantId,
          userId,
          usedAt: { not: null },
          candidateExpiresAt: { gt: this.now() },
          selectedPageId: null,
        },
        select: { encryptedPageCandidates: true },
      }));
    if (!attempt?.encryptedPageCandidates) throw pageSelectionExpired();
    try {
      const parsed: unknown = JSON.parse(this.cipher.decrypt(attempt.encryptedPageCandidates));
      if (!Array.isArray(parsed) || !parsed.every(isStoredCandidate)) throw pageSelectionExpired();
      return parsed;
    } catch {
      throw pageSelectionExpired();
    }
  }

  private async clearCandidates(tenantId: string, attemptId: string): Promise<void> {
    await withTenantTransaction(this.prisma, tenantId, (transaction) =>
      transaction.facebookOAuthAttempt.updateMany({
        where: { id: attemptId, tenantId },
        data: { encryptedPageCandidates: null, candidateExpiresAt: null },
      })).catch(() => undefined);
  }

  private async runCleanup(tenantId: string, cleanupId: string): Promise<void> {
    const leaseId = randomUUID();
    const claimedAt = this.now();
    const cleanup = await withTenantTransaction(this.prisma, tenantId, async (transaction) => {
      const claimed = await transaction.facebookCredentialCleanup.updateMany({
        where: {
          id: cleanupId,
          tenantId,
          state: 'REQUIRED',
          terminalAt: null,
          OR: [
            { leaseId: null, leaseExpiresAt: null },
            { leaseExpiresAt: { lte: claimedAt } },
          ],
        },
        data: {
          leaseId,
          leaseExpiresAt: new Date(claimedAt.getTime() + CLEANUP_LEASE_MS),
          unsubscribeStatus: 'PENDING',
          attempts: { increment: 1 },
          version: { increment: 1 },
        },
      });
      if (claimed.count !== 1) return null;
      return transaction.facebookCredentialCleanup.findFirst({
        where: { id: cleanupId, tenantId, leaseId, terminalAt: null },
        select: {
          id: true,
          credentialGenerationId: true,
          externalPageId: true,
          encryptedPageAccessToken: true,
        },
      });
    });
    if (!cleanup) return;

    try {
      await this.meta.unsubscribePage(
        cleanup.externalPageId,
        this.cipher.decrypt(cleanup.encryptedPageAccessToken),
      );
      await this.completeCleanup(tenantId, cleanup, leaseId);
    } catch (error) {
      if (error instanceof MetaFacebookError && error.providerCode === 190) {
        await this.completeCleanup(tenantId, cleanup, leaseId);
        return;
      }
      await withTenantTransaction(this.prisma, tenantId, async (transaction) => {
        await transaction.facebookCredentialCleanup.updateMany({
          where: { id: cleanup.id, tenantId, leaseId, terminalAt: null },
          data: {
            state: 'REQUIRED',
            unsubscribeStatus: 'FAILED',
            unsubscribeAttemptedAt: this.now(),
            lastErrorCode: CLEANUP_FAILED_CODE,
            leaseId: null,
            leaseExpiresAt: null,
            version: { increment: 1 },
          },
        });
        await transaction.facebookConnection.updateMany({
          where: { tenantId, status: 'DISCONNECTED' },
          data: { lastErrorCode: CLEANUP_FAILED_CODE },
        });
      });
    }
  }

  private async completeCleanup(
    tenantId: string,
    cleanup: { id: string; credentialGenerationId: string },
    leaseId: string,
  ): Promise<void> {
    const completedAt = this.now();
    await withTenantTransaction(this.prisma, tenantId, async (transaction) => {
      const completed = await transaction.facebookCredentialCleanup.updateMany({
        where: { id: cleanup.id, tenantId, leaseId, terminalAt: null },
        data: {
          state: 'COMPLETED',
          unsubscribeStatus: 'SUCCEEDED',
          unsubscribeAttemptedAt: completedAt,
          unsubscribeSucceededAt: completedAt,
          terminalAt: completedAt,
          lastErrorCode: null,
          encryptedPageAccessToken: '',
          leaseId: null,
          leaseExpiresAt: null,
          version: { increment: 1 },
        },
      });
      if (completed.count !== 1) return;
      await transaction.facebookConnection.updateMany({
        where: { tenantId, credentialGenerationId: cleanup.credentialGenerationId },
        data: {
          status: 'DISCONNECTED',
          encryptedPageAccessToken: null,
          credentialGenerationId: null,
          disconnectedAt: completedAt,
        },
      });
    });
  }

  private async getCleanupSummary(tenantId: string): Promise<{ status: 'NONE' | 'PENDING' | 'FAILED'; errorCode: string | null }> {
    const rows = await withTenantTransaction(this.prisma, tenantId, (transaction) =>
      transaction.facebookCredentialCleanup.findMany({
        where: { tenantId, terminalAt: null },
        select: { unsubscribeStatus: true, lastErrorCode: true },
      }));
    if (rows.length === 0) return noCleanup();
    const failed = rows.find((row) => row.unsubscribeStatus === 'FAILED' || row.lastErrorCode !== null);
    return failed
      ? { status: 'FAILED', errorCode: failed.lastErrorCode ?? CLEANUP_FAILED_CODE }
      : { status: 'PENDING', errorCode: null };
  }

  private async resolvePageTenant(pageId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Array<{ tenant_id: string }>>`
      SELECT tenant_id FROM public.api_facebook_tenant_for_page(${pageId})
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
    binding: Pick<FacebookOAuthBinding, 'tenantId' | 'userId'>,
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
        metadata: errorCode ? { errorCode } : {},
      },
    });
  }

  private async auditBestEffort(
    binding: Pick<FacebookOAuthBinding, 'tenantId' | 'userId'>,
    action: string,
    result: 'SUCCESS' | 'FAILURE',
    errorCode?: string,
  ): Promise<void> {
    await withTenantTransaction(this.prisma, binding.tenantId, (transaction) =>
      this.recordAudit(transaction, binding, action, result, errorCode)).catch(() => undefined);
  }

  private assertEnabled(): void {
    if (!this.enabled) throw new Error('Facebook Messenger integration is disabled');
  }
}

function publicCandidates(pages: StoredPageCandidate[]): FacebookPageCandidate[] {
  return pages.map((page) => ({ pageId: page.pageId, pageName: page.pageName }));
}

function isStoredCandidate(value: unknown): value is StoredPageCandidate {
  return typeof value === 'object' && value !== null &&
    'pageId' in value && typeof value.pageId === 'string' &&
    'pageName' in value && typeof value.pageName === 'string' &&
    'pageAccessToken' in value && typeof value.pageAccessToken === 'string' &&
    'tasks' in value && Array.isArray(value.tasks) && value.tasks.every((task) => typeof task === 'string');
}

function toSummary(
  connection: SafeConnectionRow,
  cleanup: CleanupSummary = noCleanup(),
  expired = false,
): FacebookConnectionSummary {
  return {
    status: expired ? 'REAUTH_REQUIRED' : connection.status,
    pageId: connection.externalPageId,
    pageName: connection.pageName,
    tokenExpiresAt: connection.tokenExpiresAt?.toISOString() ?? null,
    lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
    lastErrorCode: expired ? 'FACEBOOK_TOKEN_EXPIRED' : connection.lastErrorCode,
    cleanupStatus: cleanup.status,
    cleanupErrorCode: cleanup.errorCode,
  };
}

function emptySummary(cleanup: CleanupSummary = noCleanup()): FacebookConnectionSummary {
  return {
    status: 'NOT_CONNECTED',
    pageId: null,
    pageName: null,
    tokenExpiresAt: null,
    lastVerifiedAt: null,
    lastErrorCode: null,
    cleanupStatus: cleanup.status,
    cleanupErrorCode: cleanup.errorCode,
  };
}

function noCleanup(): { status: 'NONE'; errorCode: null } {
  return { status: 'NONE', errorCode: null };
}

function safeFailure(): Error {
  return new Error(SAFE_FAILURE_MESSAGE);
}

function pageSelectionExpired(): Error {
  return new Error('FACEBOOK_PAGE_SELECTION_EXPIRED');
}

function providerFailureCode(error: unknown): string {
  if (error instanceof MetaFacebookError && (error.providerCode === 10 || error.providerCode === 190)) {
    return 'FACEBOOK_REQUIRED_SCOPES_MISSING';
  }
  return 'FACEBOOK_PROVIDER_FAILED';
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

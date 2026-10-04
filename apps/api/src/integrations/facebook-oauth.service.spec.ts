import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import { MetaFacebookError } from '@autosale/integrations';

import { CredentialCipher } from './credential-cipher.js';
import { FacebookOAuthService } from './facebook-oauth.service.js';

vi.mock('@autosale/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@autosale/database')>();
  return {
    ...actual,
    assertTenantAcceptingMutations: vi.fn().mockResolvedValue(undefined),
    withTenantTransaction: <T>(
      prisma: { $transaction: (operation: (transaction: unknown) => Promise<T>) => Promise<T> },
      _tenantId: string,
      operation: (transaction: unknown) => Promise<T>,
    ) => prisma.$transaction(operation),
  };
});

const binding = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 'tenant-a',
  userId: 'owner-a',
  returnPath: '/settings?tab=social',
};

function fixture() {
  const cipher = new CredentialCipher(Buffer.alloc(32, 7));
  let encryptedPageCandidates: string | null = null;
  let candidateExpiresAt: Date | null = null;
  let selectedPageId: string | null = null;
  let connection: Record<string, unknown> | null = null;
  const transaction: any = {
    tenant: { findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    tenantMembership: {
      findUnique: vi.fn().mockResolvedValue({
        role: 'OWNER', status: 'ACTIVE', user: { status: 'ACTIVE' },
      }),
    },
    facebookOAuthAttempt: {
      updateMany: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        if ('encryptedPageCandidates' in data) encryptedPageCandidates = data.encryptedPageCandidates as string | null;
        if ('candidateExpiresAt' in data) candidateExpiresAt = data.candidateExpiresAt as Date | null;
        if ('selectedPageId' in data) selectedPageId = data.selectedPageId as string | null;
        return { count: 1 };
      }),
      findFirst: vi.fn().mockImplementation(async () => encryptedPageCandidates && candidateExpiresAt && !selectedPageId
        ? { encryptedPageCandidates }
        : null),
      findUnique: vi.fn().mockResolvedValue(binding),
    },
    facebookCredentialCleanup: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    facebookConnection: {
      findUnique: vi.fn().mockImplementation(async () => connection),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    securityAuditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) => callback(transaction),
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  const states = { consume: vi.fn().mockResolvedValue(binding), issue: vi.fn() };
  const pages = [
    { pageId: 'page-1', pageName: 'Fictional One', pageAccessToken: 'page-token-1', tasks: ['MESSAGING'] },
    { pageId: 'page-2', pageName: 'Fictional Two', pageAccessToken: 'page-token-2', tasks: ['MESSAGING'] },
  ];
  const meta = {
    getAuthorizationUrl: vi.fn(),
    exchangeCode: vi.fn().mockResolvedValue({ accessToken: 'user-token', expiresIn: 3_600 }),
    listEligiblePages: vi.fn().mockResolvedValue(pages),
    verifyPage: vi.fn(),
    subscribePage: vi.fn(),
    unsubscribePage: vi.fn(),
  };
  const gate = {
    assertEnabled: vi.fn().mockResolvedValue(undefined),
    getControl: vi.fn().mockResolvedValue({
      key: 'FACEBOOK_MESSENGER', deploymentAvailable: true, runtimeEnabled: true,
      effectiveEnabled: true, state: 'ACTIVE', updatedAt: null,
    }),
  };
  const service = new FacebookOAuthService(
    prisma,
    meta as never,
    states as never,
    cipher,
    'https://sales-aito.example',
    gate as never,
    () => new Date('2026-10-02T20:00:00.000Z'),
  );
  return {
    service, states, meta, pages, transaction, gate,
    setConnection: (value: Record<string, unknown>) => { connection = value; },
  };
}

describe('FacebookOAuthService', () => {
  it('checks the fresh platform gate before issuing authorization state', async () => {
    const { service, states, gate } = fixture();
    gate.assertEnabled.mockRejectedValueOnce(new Error('disabled'));

    await expect(service.authorize('tenant-a', 'owner-a')).rejects.toThrow('disabled');
    expect(states.issue).not.toHaveBeenCalled();
  });

  it('keeps connected Page details visible while reporting an admin pause', async () => {
    const { service, gate, setConnection } = fixture();
    setConnection({
      externalPageId: 'fictional-page', pageName: 'Fictional Page', status: 'ACTIVE',
      tokenExpiresAt: null, lastVerifiedAt: new Date('2026-10-04T10:00:00.000Z'), lastErrorCode: null,
    });
    gate.getControl.mockResolvedValueOnce({
      key: 'FACEBOOK_MESSENGER', deploymentAvailable: true, runtimeEnabled: false,
      effectiveEnabled: false, state: 'ADMIN_DISABLED', updatedAt: null,
    });

    await expect(service.getSummary('tenant-a')).resolves.toMatchObject({
      status: 'ACTIVE', pageId: 'fictional-page', platformAvailability: 'ADMIN_DISABLED',
    });
  });

  it('consumes state before provider I/O and exposes multiple Pages without tokens', async () => {
    const { service, states, meta } = fixture();

    const result = await service.completeCallback('code', 'raw-state');

    expect(states.consume.mock.invocationCallOrder[0]).toBeLessThan(meta.exchangeCode.mock.invocationCallOrder[0]!);
    expect(result).toEqual({
      kind: 'PAGE_SELECTION_REQUIRED',
      returnPath: '/settings?tab=social',
      attemptId: binding.id,
      pages: [
        { pageId: 'page-1', pageName: 'Fictional One' },
        { pageId: 'page-2', pageName: 'Fictional Two' },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('page-token');
    expect(JSON.stringify(result)).not.toContain('user-token');
  });

  it('rechecks the gate before retaining callback Page candidates', async () => {
    const { service, gate, transaction } = fixture();
    gate.assertEnabled
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('paused during callback'));

    await expect(service.completeCallback('code', 'raw-state')).rejects.toThrow('paused during callback');
    expect(transaction.facebookOAuthAttempt.updateMany).not.toHaveBeenCalled();
  });

  it('returns safe candidates from encrypted server-side state', async () => {
    const { service } = fixture();
    await service.completeCallback('code', 'raw-state');

    await expect(service.getPageCandidates('tenant-a', 'owner-a', binding.id)).resolves.toEqual({
      attemptId: binding.id,
      pages: [
        { pageId: 'page-1', pageName: 'Fictional One' },
        { pageId: 'page-2', pageName: 'Fictional Two' },
      ],
    });
  });

  it('rejects a Page ID outside the encrypted candidate set before provider access', async () => {
    const { service, meta } = fixture();
    await service.completeCallback('code', 'raw-state');

    await expect(service.selectPage('tenant-a', 'owner-a', {
      attemptId: binding.id,
      pageId: 'foreign-page',
    })).rejects.toThrow('FACEBOOK_PAGE_NOT_ELIGIBLE');
    expect(meta.verifyPage).not.toHaveBeenCalled();
  });

  it('rejects callbacks whose state owner is no longer active', async () => {
    const { service, meta, transaction } = fixture();
    transaction.tenantMembership.findUnique.mockResolvedValue({
      role: 'MANAGER', status: 'ACTIVE', user: { status: 'ACTIVE' },
    });

    await expect(service.completeCallback('code', 'raw-state')).rejects.toThrow('Facebook connection failed');
    expect(meta.exchangeCode).not.toHaveBeenCalled();
  });

  it('records the provider stage when automatic Page activation fails', async () => {
    const { service, meta, pages, transaction } = fixture();
    meta.listEligiblePages.mockResolvedValue([pages[0]]);
    meta.verifyPage.mockRejectedValue(new MetaFacebookError(403, 10, false, null, 'PAGE'));

    await expect(service.completeCallback('code', 'raw-state')).rejects.toThrow('Facebook connection failed');

    expect(transaction.securityAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'FACEBOOK_CALLBACK_FAILED',
        result: 'FAILURE',
        metadata: {
          errorCode: 'FACEBOOK_PAGE_VERIFICATION_FAILED',
          providerStage: 'PAGE',
          providerStatus: 403,
          providerCode: 10,
          providerSubcode: null,
          providerTransient: false,
        },
      }),
    });
  });
});

import { createHash } from 'node:crypto';

import { expect, test, type Browser, type Page } from '@playwright/test';
import JSZip from 'jszip';

const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const ownerAEmail = process.env.E2E_LIFECYCLE_OWNER_A_EMAIL;
const ownerAPassword = process.env.E2E_LIFECYCLE_OWNER_A_PASSWORD;
const ownerBEmail = process.env.E2E_LIFECYCLE_OWNER_B_EMAIL;
const ownerBPassword = process.env.E2E_LIFECYCLE_OWNER_B_PASSWORD;
const runLive = process.env.E2E_TENANT_LIFECYCLE_LIVE === '1';

type PublicSession = { tenantId: string | null };
type TenantSummary = { tenantId: string; tenantName: string };
type LifecycleRequest = {
  id: string;
  tenantId: string;
  status: 'REQUESTED' | 'EXPORTING' | 'EXPORT_READY' | 'FAILED' | 'CANCELLED';
  exportSha256: string | null;
  exportSizeBytes: number | null;
};

test('admin exports and freezes only the selected fictional tenant', async ({ browser }) => {
  test.skip(!hasLifecycleFixture(), 'Isolated fictional lifecycle E2E accounts are not configured');
  test.setTimeout(180_000);

  const admin = await authenticatedPage(browser, adminEmail!, adminPassword!);
  const tenantA = await authenticatedPage(browser, ownerAEmail!, ownerAPassword!);
  const tenantB = await authenticatedPage(browser, ownerBEmail!, ownerBPassword!);
  let deletionRequestId: string | null = null;

  try {
    const [sessionA, sessionB] = await Promise.all([
      apiGet<PublicSession>(tenantA, '/api/auth/session'),
      apiGet<PublicSession>(tenantB, '/api/auth/session'),
    ]);
    expect(sessionA.tenantId).not.toBeNull();
    expect(sessionB.tenantId).not.toBeNull();
    expect(sessionA.tenantId).not.toBe(sessionB.tenantId);

    const tenants = await apiGet<TenantSummary[]>(admin, '/api/admin/tenants');
    const tenantSummaryA = tenants.find((tenant) => tenant.tenantId === sessionA.tenantId);
    expect(tenantSummaryA, 'tenant A must be visible in the platform directory').toBeTruthy();

    await admin.goto('/admin');
    await expect(admin.getByRole('heading', { name: 'Адміністрування платформи' })).toBeVisible();
    const tenantCard = admin.locator('.tenant-card').filter({ hasText: tenantSummaryA!.tenantName });
    await expect(tenantCard.getByRole('button', { name: 'Керувати даними' })).toBeVisible();

    const exportRequest = await apiMutate<LifecycleRequest>(
      admin,
      `/api/admin/tenants/${sessionA.tenantId}/lifecycle-exports`,
      { reasonCode: 'ADMINISTRATIVE_TEST' },
    );
    const readyExport = await waitForLifecycle(admin, exportRequest.id, 'EXPORT_READY');
    expect(readyExport.exportSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(readyExport.exportSizeBytes).toBeGreaterThan(0);

    const downloadStepUp = await reauthenticate(admin, adminPassword!, 'TENANT_EXPORT_DOWNLOAD');
    const archive = await downloadArchive(
      admin,
      `/api/admin/tenant-lifecycle/${readyExport.id}/download`,
      { 'x-admin-step-up': downloadStepUp },
    );
    expect(archive.byteLength).toBe(readyExport.exportSizeBytes);
    expect(createHash('sha256').update(archive).digest('hex')).toBe(readyExport.exportSha256);
    await expectSafeArchive(archive, sessionA.tenantId!);

    const deletionStepUp = await reauthenticate(admin, adminPassword!, 'TENANT_DELETE_REQUEST');
    const deletion = await apiMutate<LifecycleRequest>(
      admin,
      `/api/admin/tenants/${sessionA.tenantId}/lifecycle-deletions`,
      { reasonCode: 'ADMINISTRATIVE_TEST' },
      { 'x-admin-step-up': deletionStepUp },
    );
    deletionRequestId = deletion.id;

    const settingsA = mutableOrderSettings(await apiGet<Record<string, unknown>>(tenantA, '/api/settings/orders'));
    const frozenResponse = await rawMutate(tenantA, '/api/settings/orders', settingsA, {}, 'PATCH');
    expect(frozenResponse.status).toBe(409);
    expect(JSON.stringify(frozenResponse.body)).toContain('TENANT_LIFECYCLE_FROZEN');

    const settingsB = mutableOrderSettings(await apiGet<Record<string, unknown>>(tenantB, '/api/settings/orders'));
    const unaffectedResponse = await rawMutate(tenantB, '/api/settings/orders', settingsB, {}, 'PATCH');
    expect(unaffectedResponse.status).toBe(200);
  } finally {
    if (deletionRequestId) {
      await rawMutate(admin, `/api/admin/tenant-lifecycle/${deletionRequestId}/cancel`, undefined);
    }
    await Promise.all([admin.context().close(), tenantA.context().close(), tenantB.context().close()]);
  }
});

function mutableOrderSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return {
    intentDetectionMode: settings.intentDetectionMode,
    approvalMode: settings.approvalMode,
    autoApprovalThreshold: settings.autoApprovalThreshold,
    triggerPhrases: settings.triggerPhrases,
  };
}

function hasLifecycleFixture(): boolean {
  return runLive && Boolean(
    adminEmail && adminPassword
    && ownerAEmail && ownerAPassword
    && ownerBEmail && ownerBPassword,
  );
}

async function authenticatedPage(browser: Browser, email: string, password: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  return page;
}

async function apiGet<T>(page: Page, path: string): Promise<T> {
  const response = await page.evaluate(async (requestPath) => {
    const result = await fetch(requestPath, { cache: 'no-store' });
    return { status: result.status, body: await result.json() as unknown };
  }, path);
  expect(response.status, `GET ${path}`).toBe(200);
  return response.body as T;
}

async function apiMutate<T>(
  page: Page,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  method = 'POST',
): Promise<T> {
  const response = await rawMutate(page, path, body, headers, method);
  expect(response.status, `${method} ${path}: ${JSON.stringify(response.body)}`).toBeLessThan(300);
  return response.body as T;
}

async function rawMutate(
  page: Page,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  method = 'POST',
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(async ({ requestPath, requestBody, requestHeaders, requestMethod }) => {
    const csrf = await fetch('/api/auth/csrf', { method: 'POST' });
    const { token } = await csrf.json() as { token: string };
    const result = await fetch(requestPath, {
      method: requestMethod,
      headers: {
        'x-csrf-token': token,
        'idempotency-key': crypto.randomUUID(),
        ...(requestBody === undefined ? {} : { 'content-type': 'application/json' }),
        ...requestHeaders,
      },
      ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) }),
    });
    let responseBody: unknown = null;
    try { responseBody = await result.json(); } catch { responseBody = null; }
    return { status: result.status, body: responseBody };
  }, { requestPath: path, requestBody: body, requestHeaders: headers, requestMethod: method });
}

async function reauthenticate(
  page: Page,
  currentPassword: string,
  purpose: 'TENANT_DELETE_REQUEST' | 'TENANT_EXPORT_DOWNLOAD',
): Promise<string> {
  const response = await apiMutate<{ stepUpToken: string }>(page, '/api/admin/reauth', {
    currentPassword,
    purpose,
  });
  return response.stepUpToken;
}

async function downloadArchive(
  page: Page,
  path: string,
  headers: Record<string, string>,
): Promise<Buffer> {
  const response = await page.evaluate(async ({ requestPath, requestHeaders }) => {
    const csrf = await fetch('/api/auth/csrf', { method: 'POST' });
    const { token } = await csrf.json() as { token: string };
    const result = await fetch(requestPath, {
      method: 'POST',
      headers: {
        'x-csrf-token': token,
        'idempotency-key': crypto.randomUUID(),
        ...requestHeaders,
      },
    });
    return {
      status: result.status,
      contentType: result.headers.get('content-type'),
      contentDisposition: result.headers.get('content-disposition'),
      bytes: Array.from(new Uint8Array(await result.arrayBuffer())),
    };
  }, { requestPath: path, requestHeaders: headers });
  expect(response.status, `POST ${path}`).toBeLessThan(300);
  expect(response.contentType).toContain('application/zip');
  expect(response.contentDisposition).toContain('attachment');
  return Buffer.from(response.bytes);
}

async function waitForLifecycle(
  page: Page,
  requestId: string,
  expected: LifecycleRequest['status'],
): Promise<LifecycleRequest> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const request = await apiGet<LifecycleRequest>(page, `/api/admin/tenant-lifecycle/${requestId}`);
    if (request.status === expected) return request;
    if (request.status === 'FAILED') throw new Error(`Lifecycle request failed: ${requestId}`);
    await page.waitForTimeout(1_000);
  }
  throw new Error(`Lifecycle request did not reach ${expected}: ${requestId}`);
}

async function expectSafeArchive(bytes: Buffer, tenantId: string): Promise<void> {
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.values(zip.files).filter((file) => !file.dir);
  expect(files.map((file) => file.name)).toEqual(expect.arrayContaining([
    'manifest.json',
    'README.json',
    'objects/manifest.jsonl',
  ]));
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as {
    tenantId: string;
    excludedCategories: string[];
  };
  expect(manifest.tenantId).toBe(tenantId);
  expect(manifest.excludedCategories).toEqual(expect.arrayContaining([
    'provider_credentials',
    'password_hashes',
    'sessions',
    'authentication_tokens',
  ]));

  const forbiddenKeys = [
    'passwordHash', 'tokenHash', 'accessTokenEncrypted', 'refreshTokenEncrypted',
    'apiKeyEncrypted', 'leaseId', 'leaseExpiresAt', 'signedUrl',
  ];
  for (const file of files.filter((entry) => entry.name.endsWith('.json') || entry.name.endsWith('.jsonl'))) {
    const content = await file.async('string');
    for (const forbidden of forbiddenKeys) expect(content, `${file.name} contains ${forbidden}`).not.toContain(forbidden);
  }
}

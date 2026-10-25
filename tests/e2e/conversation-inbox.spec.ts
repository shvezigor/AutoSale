import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type APIRequestContext } from '@playwright/test';
import type { ConversationDetailResponse } from '../../packages/contracts/src/conversations';

const appSecret = process.env.META_APP_SECRET ?? 'replace-with-meta-app-secret';

test.beforeEach(async ({ page }) => {
  const email = process.env.E2E_OWNER_EMAIL;
  const password = process.env.E2E_OWNER_PASSWORD;
  test.skip(!email || !password, 'E2E owner credentials are not configured');
  await page.goto('/login');
  await page.getByLabel('Email').fill(email!);
  await page.getByLabel('Пароль').fill(password!);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await expect(page).not.toHaveURL(/\/login/);
});

test('manager opens an Instagram conversation with a photo', async ({ page }) => {
  await deliverFixture(page.request, 'text-message.json');
  await deliverFixture(page.request, 'image-message.json');

  await expect
    .poll(async () => {
      const response = await page.request.get('/api/conversations?limit=20');
      const body = (await response.json()) as { items?: unknown[] };
      return body.items?.length ?? 0;
    })
    .toBeGreaterThan(0);

  await page.goto('/conversations');
  await page.getByRole('link', { name: /Вкладення з Instagram/i }).click();
  await expect(page.getByText('Хочу чорну модель 38 розміру')).toBeVisible();
  await expect(page.getByRole('img', { name: /вкладення з Instagram/i })).toBeVisible();
});

test('replayed Meta webhook creates one normalized message', async ({ page }) => {
  const uniqueId = `m_replay_${Date.now()}`;
  const marker = `Replay acceptance ${uniqueId}`;
  const payload = Buffer.from(JSON.stringify({
    object: 'instagram',
    entry: [{
      id: '17841400000000000',
      time: Date.now(),
      messaging: [{
        sender: { id: 'ig-user-replay' },
        recipient: { id: '17841400000000000' },
        timestamp: Date.now(),
        message: { mid: uniqueId, text: marker },
      }],
    }],
  }));

  await deliverBody(page.request, payload);
  await deliverBody(page.request, payload);

  await expect.poll(async () => countMessagesContaining(page.request, marker)).toBe(1);
});

test('manager opens an AI-created order and sees its Sheets state', async ({ page }) => {
  await page.goto('/orders');
  const order = page.getByRole('link', { name: /Клієнт Instagram.*Urban Black/i }).first();
  await expect(order).toBeVisible();
  await order.click();
  await expect(page.getByRole('region', { name: 'Замовлення' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Товар 1' })).toHaveValue('UB-038-BLK');
  await expect(page.getByRole('heading', { name: 'Очікує синхронізації' })).toBeVisible();
});

test('triage persists reversible moves, preserves detail, recovers conflicts and reopens on signed inbound', async ({ page }, testInfo) => {
  test.skip(process.env.E2E_TRIAGE_ISOLATED !== '1' || !process.env.E2E_INSTAGRAM_ACCOUNT_ID || !process.env.META_APP_SECRET,
    'Requires an isolated fictional owner/account with outbound provider egress disabled; see conversation-triage-checklist.md');
  test.setTimeout(90_000);
  const marker = `Fictional triage ${Date.now()}`;
  const sender = `fictional-triage-${Date.now()}`;
  const account = process.env.E2E_INSTAGRAM_ACCOUNT_ID!;
  const inbound = (text: string) => Buffer.from(JSON.stringify({ object: 'instagram', entry: [{ id: account,
    time: Date.now(), messaging: [{ sender: { id: sender }, recipient: { id: account }, timestamp: Date.now(),
      message: { mid: `${sender}-${text}`, text } }] }] }));
  await deliverBody(page.request, inbound(marker));
  let id = '';
  await expect.poll(async () => {
    const response = await page.request.get('/api/conversations?limit=50');
    expect(response.ok()).toBe(true);
    const list = await response.json() as { items: Array<{ id: string; lastMessagePreview: string | null }> };
    id = list.items.find(item => item.lastMessagePreview === marker)?.id ?? '';
    return id;
  }, { timeout: 20_000 }).not.toBe('');
  const detail = async (): Promise<ConversationDetailResponse> => {
    const response = await page.request.get(`/api/conversations/${id}`);
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const patch = async (data: unknown) => {
    const csrf = await page.request.post('/api/auth/csrf');
    expect(csrf.ok()).toBe(true);
    const { token } = await csrf.json() as { token: string };
    return page.request.patch(`/api/conversations/${id}/status`, { data, headers: { 'x-csrf-token': token } });
  };
  const outboundRequests: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && /\/api\/conversations\/[^/]+\/(messages|replies)/.test(request.url())) outboundRequests.push(request.url());
  });
  await page.goto(`/conversations/${id}?status=ACTIVE`);
  const trigger = page.locator(`#conversation-status-detail-${id}`);
  const status = page.locator('.conversation-status-detail .conversation-status-label');
  const row = () => page.locator(`a[href^="/conversations/${id}?"]`);
  const move = async (name: string) => {
    await trigger.click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  };
  await expect(page.getByText(marker, { exact: true }).last()).toBeVisible();
  await move('До неактивних');
  await expect(status).toHaveText('Неактивні');
  await expect(row()).toHaveCount(0);
  await expect(page.getByText(marker, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/conversations/${id}\\?status=ACTIVE`));
  await page.getByRole('tab', { name: /^Неактивні/ }).click();
  await page.reload();
  await expect(page.getByRole('tab', { name: /^Неактивні/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(new RegExp(`/conversations/${id}\\?status=inactive`));
  await expect(row()).toBeVisible();
  await expect(status).toHaveText('Неактивні');
  await move('До активних');
  await expect(status).toHaveText('Активні');
  await expect(row()).toHaveCount(0);
  await page.getByRole('tab', { name: /^Активні/ }).click();
  await expect(row()).toBeVisible();
  await page.reload();
  await expect(status).toHaveText('Активні');

  const beforeInvalid = await detail();
  expect((await patch({ status: 'INVALID', expectedVersion: beforeInvalid.statusVersion })).status()).toBe(400);
  expect((await detail()).workflowStatus).toBe('ACTIVE');
  // Exercise the real validation response through the UI without offering an invalid menu option.
  await page.route(`**/api/conversations/${id}/status`, async route => {
    await route.continue({ postData: JSON.stringify({ status: 'INVALID', expectedVersion: beforeInvalid.statusVersion }) });
  }, { times: 1 });
  await move('До закритих');
  await expect(page.getByRole('alert').filter({ hasText: 'Не вдалося змінити статус.' }).first()).toBeVisible();
  await expect(status).toHaveText('Активні');

  // A competing manager wins immediately before this browser's request reaches the API.
  await page.route(`**/api/conversations/${id}/status`, async route => {
    const current = await detail();
    expect((await patch({ status: 'INACTIVE', expectedVersion: current.statusVersion })).ok()).toBe(true);
    await route.continue();
  }, { times: 1 });
  await move('До закритих');
  await expect(page.getByRole('alert').filter({ hasText: 'Статус уже змінився.' }).first()).toBeVisible();
  await expect(status).toHaveText('Неактивні');
  await expect(trigger).toBeEnabled();
  await move('До закритих');
  await expect(status).toHaveText('Закриті');
  await page.getByRole('tab', { name: /^Закриті/ }).click();
  await page.reload();
  await expect(row()).toBeVisible();
  const closedVersion = (await detail()).statusVersion;
  const reopened = `${marker} new inbound`;
  const body = inbound(reopened);
  await deliverBody(page.request, body);
  await deliverBody(page.request, body);
  await expect.poll(async () => (await detail()).workflowStatus, { timeout: 20_000 }).toBe('ACTIVE');
  const after = await detail();
  expect(after.statusVersion).toBe(closedVersion + 1);
  expect(after.messages.filter(message => message.text === reopened)).toHaveLength(1);
  expect(after.messages.filter(message => message.direction === 'OUTBOUND')).toEqual([]);
  expect(outboundRequests).toEqual([]);
  await page.reload();
  await expect(status).toHaveText('Активні');
  await expect(row()).toHaveCount(0);
  await page.getByRole('tab', { name: /^Активні/ }).click();
  await expect(row()).toBeVisible();
  await expect(page.getByText(reopened, { exact: true }).last()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('triage-reopened.png'), fullPage: true });
});

async function deliverFixture(request: APIRequestContext, name: string): Promise<void> {
  const body = await readFile(resolve(process.cwd(), `tests/fixtures/meta/${name}`));
  await deliverBody(request, body);
}

async function deliverBody(request: APIRequestContext, body: Buffer): Promise<void> {
  const signature = `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`;
  const response = await request.post('/webhooks/meta', {
    data: body,
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signature,
    },
  });
  expect(response.ok()).toBe(true);
}

async function countMessagesContaining(request: APIRequestContext, marker: string): Promise<number> {
  const listResponse = await request.get('/api/conversations?limit=50');
  expect(listResponse.ok()).toBe(true);
  const list = (await listResponse.json()) as { items: Array<{ id: string }> };
  let count = 0;
  for (const conversation of list.items) {
    const detailResponse = await request.get(`/api/conversations/${conversation.id}`);
    if (!detailResponse.ok()) continue;
    const detail = (await detailResponse.json()) as { messages?: Array<{ text?: string | null }> };
    count += detail.messages?.filter((message) => message.text === marker).length ?? 0;
  }
  return count;
}

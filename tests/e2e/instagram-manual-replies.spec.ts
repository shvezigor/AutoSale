import { createHmac } from 'node:crypto';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;
const appSecret = process.env.META_APP_SECRET;
const instagramAccountId = process.env.E2E_INSTAGRAM_ACCOUNT_ID;
const stubEnabled = process.env.E2E_META_SEND_STUB === '1';

test.beforeEach(async ({ page }) => {
  test.skip(
    !ownerEmail || !ownerPassword || !appSecret || !instagramAccountId || !stubEnabled,
    'Instagram reply fixture stack is not configured',
  );
  await login(page);
});

test('sends one durable reply and still shows it once after reload', async ({ page }) => {
  const inboundMarker = `Reply fixture ${Date.now()}`;
  await deliverInbound(page.request, inboundMarker);
  const conversationId = await findConversationByMessage(page.request, inboundMarker);
  const reply = `Відповідь AutoSale ${Date.now()}`;

  await page.goto(`/conversations/${conversationId}`);
  const composer = page.getByRole('textbox', { name: 'Відповідь' });
  await expect(composer).toBeEnabled();
  await composer.fill(reply);
  await page.getByRole('button', { name: 'Надіслати' }).click();

  await expect(page.getByText(reply, { exact: true })).toHaveCount(1);
  await expect(page.getByText('Надіслано').last()).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.getByText(reply, { exact: true })).toHaveCount(1);
});

test('a fixture rate-limit failure retries the same bubble', async ({ page }) => {
  const conversationId = process.env.E2E_INSTAGRAM_RETRY_CONVERSATION_ID;
  const retryText = process.env.E2E_INSTAGRAM_RETRY_TEXT;
  test.skip(!conversationId || !retryText, 'Retry fixture message is not seeded');

  await page.goto(`/conversations/${conversationId}`);
  const bubble = page.getByText(retryText!, { exact: true });
  await expect(bubble).toHaveCount(1);
  await page.getByRole('button', { name: 'Повторити надсилання' }).click();
  await expect(page.getByText(retryText!, { exact: true })).toHaveCount(1);
  await expect(page.getByText('Надіслано').last()).toBeVisible({ timeout: 20_000 });
});

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ownerEmail!);
  await page.getByLabel('Пароль').fill(ownerPassword!);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function deliverInbound(request: APIRequestContext, marker: string) {
  const body = Buffer.from(JSON.stringify({
    object: 'instagram',
    entry: [{
      id: instagramAccountId,
      time: Date.now(),
      messaging: [{
        sender: { id: `ig-reply-fixture-${Date.now()}` },
        recipient: { id: instagramAccountId },
        timestamp: Date.now(),
        message: { mid: `mid.reply.${Date.now()}`, text: marker },
      }],
    }],
  }));
  const signature = `sha256=${createHmac('sha256', appSecret!).update(body).digest('hex')}`;
  const response = await request.post('/webhooks/meta', {
    data: body,
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
  });
  expect(response.ok()).toBe(true);
}

async function findConversationByMessage(request: APIRequestContext, marker: string): Promise<string> {
  let found: string | undefined;
  await expect.poll(async () => {
    const response = await request.get('/api/conversations?limit=50');
    if (!response.ok()) return false;
    const list = await response.json() as { items: Array<{ id: string }> };
    for (const item of list.items) {
      const detailResponse = await request.get(`/api/conversations/${item.id}`);
      if (!detailResponse.ok()) continue;
      const detail = await detailResponse.json() as { messages: Array<{ text: string | null }> };
      if (detail.messages.some((message) => message.text === marker)) {
        found = item.id;
        return true;
      }
    }
    return false;
  }, { timeout: 15_000 }).toBe(true);
  return found!;
}

import { createHmac } from 'node:crypto';

import { expect, test, type APIRequestContext } from '@playwright/test';

const appSecret = process.env.META_APP_SECRET;
const pageId = process.env.E2E_FACEBOOK_PAGE_ID;

test.beforeEach(async ({ page }) => {
  const email = process.env.E2E_OWNER_EMAIL;
  const password = process.env.E2E_OWNER_PASSWORD;
  test.skip(
    process.env.E2E_FACEBOOK_CONNECTED !== '1' || !email || !password || !appSecret || !pageId,
    'A controlled connected Facebook Page and E2E credentials are required',
  );
  await page.goto('/login');
  await page.getByLabel('Email').fill(email!);
  await page.getByLabel('Пароль').fill(password!);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await expect(page).not.toHaveURL(/\/login/);
});

test('Facebook Messenger inbound is idempotent and read-only in the inbox', async ({ page }) => {
  const messageId = `mid.facebook.acceptance.${Date.now()}`;
  const marker = `Fictional Facebook acceptance ${messageId}`;
  const body = Buffer.from(JSON.stringify({
    object: 'page',
    entry: [{
      id: pageId,
      time: Date.now(),
      messaging: [{
        sender: { id: 'fictional-facebook-psid-e2e' },
        recipient: { id: pageId },
        timestamp: Date.now(),
        message: { mid: messageId, text: marker },
      }],
    }],
  }));

  await deliverBody(page.request, body);
  await deliverBody(page.request, body);

  await expect.poll(
    async () => findFacebookConversation(page.request, marker),
    { timeout: 30_000 },
  ).not.toBeNull();
  const conversationId = await findFacebookConversation(page.request, marker);

  expect(conversationId).not.toBeNull();
  const detailResponse = await page.request.get(`/api/conversations/${conversationId}`);
  expect(detailResponse.ok()).toBe(true);
  const detail = (await detailResponse.json()) as {
    channel: string;
    replyCapability: { enabled: boolean; reason: string | null };
    messages: Array<{ text?: string | null }>;
  };
  expect(detail.channel).toBe('FACEBOOK');
  expect(detail.replyCapability).toEqual({ enabled: false, reason: 'CHANNEL_READ_ONLY' });
  expect(detail.messages.filter((message) => message.text === marker)).toHaveLength(1);

  await page.goto(`/conversations/${conversationId}`);
  await expect(page.getByText(marker)).toBeVisible();
  await expect(page.getByText('Facebook', { exact: true })).toBeVisible();
  await expect(page.getByText(/Facebook replies are currently|Відповіді у Facebook поки/)).toBeVisible();
});

async function deliverBody(request: APIRequestContext, body: Buffer): Promise<void> {
  const signature = `sha256=${createHmac('sha256', appSecret!).update(body).digest('hex')}`;
  const response = await request.post('/webhooks/meta', {
    data: body,
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signature,
    },
  });
  expect(response.ok()).toBe(true);
}

async function findFacebookConversation(request: APIRequestContext, marker: string): Promise<string | null> {
  const listResponse = await request.get('/api/conversations?limit=50');
  if (!listResponse.ok()) return null;
  const list = (await listResponse.json()) as { items?: Array<{ id: string; channel: string }> };
  for (const conversation of list.items ?? []) {
    if (conversation.channel !== 'FACEBOOK') continue;
    const detailResponse = await request.get(`/api/conversations/${conversation.id}`);
    if (!detailResponse.ok()) continue;
    const detail = (await detailResponse.json()) as { messages?: Array<{ text?: string | null }> };
    if (detail.messages?.some((message) => message.text === marker)) return conversation.id;
  }
  return null;
}

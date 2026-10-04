import { createHmac } from 'node:crypto';

import { expect, test, type APIRequestContext } from '@playwright/test';

const appSecret = process.env.TIKTOK_CLIENT_SECRET;
const appId = process.env.TIKTOK_CLIENT_ID;
const accountId = process.env.E2E_TIKTOK_ACCOUNT_ID;

test.beforeEach(async ({ page }) => {
  const email = process.env.E2E_OWNER_EMAIL;
  const password = process.env.E2E_OWNER_PASSWORD;
  test.skip(
    process.env.E2E_TIKTOK_CONNECTED !== '1' || !email || !password || !appSecret || !appId || !accountId,
    'An isolated connected TikTok Business Account and E2E credentials are required',
  );
  await page.goto('/login');
  await page.getByLabel('Email').fill(email!);
  await page.getByLabel('Пароль').fill(password!);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await expect(page).not.toHaveURL(/\/login/);
});

test('duplicate signed TikTok webhook creates one inbox message with truthful reply capability', async ({ page }) => {
  const messageId = `fictional-tiktok-e2e-${Date.now()}`;
  const marker = `Хочу замовити Fictional Product ${messageId}`;
  const timestamp = Date.now();
  const body = Buffer.from(JSON.stringify({
    client_key: appId,
    event: 'im_receive_msg',
    create_time: Math.floor(timestamp / 1_000),
    user_openid: accountId,
    content: JSON.stringify({
      from: 'fictional_customer',
      to: accountId,
      unique_identifier: `fictional-customer-${messageId}`,
      from_user: { id: `fictional-customer-${messageId}`, role: 'personal_account' },
      to_user: { id: accountId, role: 'business_account' },
      conversation_id: `fictional-conversation-${messageId}`,
      message_id: messageId,
      timestamp,
      type: 'text',
      text: { body: marker },
      scene_type: 0,
      is_follower: true,
      message_tag: { source: 'APP' },
    }),
  }));

  await deliverBody(page.request, body);
  await deliverBody(page.request, body);

  await expect.poll(
    async () => findTikTokConversation(page.request, marker),
    { timeout: 30_000 },
  ).not.toBeNull();
  const conversationId = await findTikTokConversation(page.request, marker);

  expect(conversationId).not.toBeNull();
  const detailResponse = await page.request.get(`/api/conversations/${conversationId}`);
  expect(detailResponse.ok()).toBe(true);
  const detail = (await detailResponse.json()) as {
    channel: string;
    replyCapability: { enabled: boolean; reason: string | null };
    messages: Array<{ text?: string | null }>;
  };
  expect(detail.channel).toBe('TIKTOK');
  expect(
    detail.replyCapability.enabled || [
      'NOT_CONNECTED',
      'RECONNECT_REQUIRED',
      'TIKTOK_CAPABILITY_UNAVAILABLE',
      'TIKTOK_REPLY_NOT_PERMITTED',
    ].includes(detail.replyCapability.reason ?? ''),
  ).toBe(true);
  expect(detail.messages.filter((message) => message.text === marker)).toHaveLength(1);

  await page.goto(`/conversations/${conversationId}`);
  await expect(page.getByText(marker)).toBeVisible();
  await expect(page.getByText('TikTok', { exact: true })).toBeVisible();
  const composer = page.getByRole('textbox', { name: /Відповідь|Reply/ });
  await expect(composer).toBeVisible();
  if (detail.replyCapability.enabled) await expect(composer).toBeEnabled();
  else await expect(composer).toBeDisabled();
});

async function deliverBody(request: APIRequestContext, body: Buffer): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1_000);
  const signature = createHmac('sha256', appSecret!)
    .update(`${timestamp}.${body.toString('utf8')}`)
    .digest('hex');
  const response = await request.post('/webhooks/tiktok', {
    data: body,
    headers: {
      'Content-Type': 'application/json',
      'TikTok-Signature': `t=${timestamp},s=${signature}`,
    },
  });
  expect(response.ok()).toBe(true);
}

async function findTikTokConversation(request: APIRequestContext, marker: string): Promise<string | null> {
  const listResponse = await request.get('/api/conversations?limit=50');
  if (!listResponse.ok()) return null;
  const list = (await listResponse.json()) as { items?: Array<{ id: string; channel: string }> };
  for (const conversation of list.items ?? []) {
    if (conversation.channel !== 'TIKTOK') continue;
    const detailResponse = await request.get(`/api/conversations/${conversation.id}`);
    if (!detailResponse.ok()) continue;
    const detail = (await detailResponse.json()) as { messages?: Array<{ text?: string | null }> };
    if (detail.messages?.some((message) => message.text === marker)) return conversation.id;
  }
  return null;
}

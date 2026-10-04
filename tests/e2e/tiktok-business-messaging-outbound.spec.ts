import { expect, test, type Page } from '@playwright/test';

const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;
const conversationId = process.env.E2E_TIKTOK_OUTBOUND_CONVERSATION_ID;

test.beforeEach(async ({ page }) => {
  test.skip(
    process.env.E2E_TIKTOK_OUTBOUND_CONNECTED !== '1' || !ownerEmail || !ownerPassword || !conversationId,
    'A controlled TikTok conversation with outbound capability is required',
  );
  await login(page);
});

test('one manager action produces one provider-confirmed TikTok reply', async ({ page }) => {
  const before = await getConversation(page, conversationId!);
  test.skip(!before.replyCapability.enabled, `TikTok reply is unavailable: ${before.replyCapability.reason ?? 'unknown'}`);

  const reply = `Fictional TikTok acceptance ${Date.now()}`;
  await page.goto(`/conversations/${conversationId}`);
  const composer = page.getByRole('textbox', { name: /Відповідь|Reply/ });
  await expect(composer).toBeEnabled();
  await composer.fill(reply);
  await page.getByRole('button', { name: /Надіслати|Send/ }).dblclick();

  await expect(page.getByText(reply, { exact: true })).toHaveCount(1);
  await expect.poll(async () => {
    const detail = await getConversation(page, conversationId!);
    const matches = detail.messages.filter((message) => message.text === reply);
    return { count: matches.length, status: matches[0]?.delivery?.status ?? null };
  }, { timeout: 30_000 }).toEqual({ count: 1, status: 'SENT' });

  await page.reload();
  await expect(page.getByText(reply, { exact: true })).toHaveCount(1);
  await expect(page.getByText(/Надіслано|Sent/).last()).toBeVisible();
});

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ownerEmail!);
  await page.getByLabel(/Пароль|Password/).fill(ownerPassword!);
  await page.getByRole('button', { name: /Увійти|Sign in/ }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function getConversation(page: Page, id: string): Promise<{
  replyCapability: { enabled: boolean; reason: string | null };
  messages: Array<{ text: string | null; delivery: { status: string } | null }>;
}> {
  const response = await page.request.get(`/api/conversations/${id}`);
  expect(response.ok()).toBe(true);
  return response.json();
}

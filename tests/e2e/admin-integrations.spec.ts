import { expect, test, type Page } from '@playwright/test';

const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const runLive = process.env.E2E_ADMIN_CHANNEL_CONTROLS_LIVE === '1';

type IntegrationControl = {
  key: 'FACEBOOK_MESSENGER' | 'TIKTOK_BUSINESS_MESSAGING';
  deploymentAvailable: boolean;
  runtimeEnabled: boolean;
  effectiveEnabled: boolean;
  state: 'ACTIVE' | 'ADMIN_DISABLED' | 'DEPLOYMENT_UNAVAILABLE';
  updatedAt: string | null;
};

test('admin safely controls social channels on desktop and mobile', async ({ page }) => {
  test.skip(!runLive || !adminEmail || !adminPassword, 'Isolated platform-admin channel-control fixture is not configured');
  await login(page, adminEmail!, adminPassword!);
  const initial = await apiGet<IntegrationControl[]>(page, '/api/admin/integrations');
  expect(initial).toHaveLength(2);
  const available = initial.find((control) => control.deploymentAvailable);
  expect(available, 'at least one channel must be available in the isolated test deployment').toBeTruthy();

  try {
    await apiPatch(page, available!.key, true);
    await page.goto('/admin/integrations');
    await expect(page.getByRole('heading', { name: 'Інтеграції каналів' })).toBeVisible();
    await expect(page.locator('.admin-integration-card')).toHaveCount(2);

    for (const control of initial.filter((row) => !row.deploymentAvailable)) {
      const card = channelCard(page, control.key);
      await expect(card.getByText('Недоступно в цьому розгортанні')).toBeVisible();
      await expect(card.getByRole('button')).toHaveCount(0);
    }

    const card = channelCard(page, available!.key);
    const disable = card.getByRole('button', { name: 'Вимкнути' });
    await disable.focus();
    await expect(disable).toBeFocused();
    await disable.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Наявні дані залишаться');
    await dialog.getByRole('button', { name: 'Скасувати' }).click();
    await expect(card.getByText('Активний')).toBeVisible();

    await disable.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Так, вимкнути' }).click();
    await expect(card.getByText('Вимкнено адміністратором')).toBeVisible();
    await card.getByRole('button', { name: 'Увімкнути' }).click();
    await expect(card.getByText('Активний')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Відкрити меню' }).click();
    await expect(page.getByRole('dialog', { name: 'Навігація адміністратора' }).getByRole('link', { name: 'Інтеграції' })).toBeVisible();
    await page.getByRole('button', { name: 'Закрити меню' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally {
    for (const control of initial) {
      if (control.deploymentAvailable) await apiPatch(page, control.key, control.runtimeEnabled);
    }
  }
});

function channelCard(page: Page, key: IntegrationControl['key']) {
  const name = key === 'FACEBOOK_MESSENGER' ? 'Facebook Messenger' : 'TikTok';
  return page.locator('.admin-integration-card').filter({ has: page.getByRole('heading', { name }) });
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function apiGet<T>(page: Page, path: string): Promise<T> {
  const response = await page.evaluate(async (requestPath) => {
    const result = await fetch(requestPath, { cache: 'no-store' });
    return { status: result.status, body: await result.json() as unknown };
  }, path);
  expect(response.status).toBe(200);
  return response.body as T;
}

async function apiPatch(page: Page, key: IntegrationControl['key'], enabled: boolean): Promise<void> {
  const response = await page.evaluate(async ({ channel, nextEnabled }) => {
    const csrf = await fetch('/api/auth/csrf', { method: 'POST' });
    const { token } = await csrf.json() as { token: string };
    const result = await fetch(`/api/admin/integrations/${channel}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-csrf-token': token },
      body: JSON.stringify({ enabled: nextEnabled }),
    });
    return result.status;
  }, { channel: key, nextEnabled: enabled });
  expect(response).toBe(200);
}

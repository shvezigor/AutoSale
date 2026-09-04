import { expect, test, type Page } from '@playwright/test';

const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;

test.beforeEach(async ({ page }) => {
  test.skip(!ownerEmail || !ownerPassword, 'E2E owner credentials are not configured');
  await login(page, ownerEmail!, ownerPassword!);
});

test('shows operation progress and a completion toast', async ({ page }) => {
  await mockNotifications(page);
  await page.goto('/settings?tab=orders');
  let finishRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => { finishRequest = resolve; });
  await page.route('**/api/settings/orders', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await requestGate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });

  await page.getByRole('button', { name: 'Зберегти налаштування' }).click();
  await expect(page.getByRole('button', { name: 'Зберігаємо…' })).toBeDisabled();
  await expect(page.getByRole('progressbar', { name: 'Зберігаємо правила підтвердження' })).toBeVisible();
  finishRequest();
  await expect(page.getByRole('status').filter({ hasText: 'Налаштування збережено' })).toBeVisible();
});

test('reads one notification and marks all remaining notifications read', async ({ page }) => {
  let unreadCount = 2;
  await mockNotifications(page, () => unreadCount, (count) => { unreadCount = count; });
  await page.goto('/orders');

  const bell = page.getByRole('button', { name: 'Сповіщення: 2 непрочитаних' });
  await bell.click();
  await page.getByRole('button', { name: /Каталог готовий/ }).click();
  await expect(page.getByRole('button', { name: 'Сповіщення: 1 непрочитаних' })).toBeVisible();
  await page.getByRole('button', { name: 'Сповіщення: 1 непрочитаних' }).click();
  await page.getByRole('button', { name: 'Прочитати всі' }).click();
  await expect(page.getByRole('button', { name: 'Сповіщення', exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Сповіщення', exact: true })).toBeVisible();
});

test('profile menu supports keyboard dismissal, focus return and settings navigation', async ({ page }) => {
  await mockNotifications(page);
  await page.goto('/orders');
  const profile = page.getByRole('button', { name: 'Меню профілю' });
  await profile.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(profile).toBeFocused();
  await profile.click();
  await page.getByRole('menuitem', { name: 'Налаштування' }).click();
  await expect(page).toHaveURL(/\/settings/);
});

for (const viewport of [{ width: 320, height: 720 }, { width: 768, height: 900 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
  test(`keeps the authenticated shell usable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockNotifications(page);
    const consoleErrors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.goto('/orders');
    await expect(page.getByRole('button', { name: /Сповіщення/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Меню профілю' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(consoleErrors).toEqual([]);
  });
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function mockNotifications(page: Page, getUnread = () => 0, setUnread: (count: number) => void = () => undefined) {
  await page.route('**/api/notifications?limit=20', async (route) => {
    const unreadCount = getUnread();
    const items = unreadCount === 0 ? [] : [
      { id: 'n1', type: 'SUCCESS', category: 'CATALOGUE_IMPORT_COMPLETED', title: 'Каталог готовий', message: 'Товари завантажено.', actionUrl: null, readAt: unreadCount < 2 ? new Date().toISOString() : null, createdAt: new Date().toISOString() },
      { id: 'n2', type: 'WARNING', category: 'GOOGLE_REAUTHORIZATION_REQUIRED', title: 'Підключіть Google повторно', message: null, actionUrl: null, readAt: unreadCount === 0 ? new Date().toISOString() : null, createdAt: new Date().toISOString() },
    ];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, unreadCount }) });
  });
  await page.route('**/api/notifications/read-all', async (route) => {
    setUnread(0);
    await route.fulfill({ status: 204, body: '' });
  });
  await page.route(/\/api\/notifications\/[^/]+\/read$/, async (route) => {
    setUnread(Math.max(0, getUnread() - 1));
    await route.fulfill({ status: 204, body: '' });
  });
}

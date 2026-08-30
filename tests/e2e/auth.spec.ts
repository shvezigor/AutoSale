import { expect, test } from '@playwright/test';

const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;
const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;

test('owner logs in and opens team management', async ({ page }) => {
  test.skip(!ownerEmail || !ownerPassword, 'E2E owner credentials are not configured');
  await login(page, ownerEmail!, ownerPassword!);
  await page.goto('/team');
  await expect(page.getByRole('heading', { name: 'Команда' })).toBeVisible();
  await expect(page.getByLabel('Email менеджера')).toBeVisible();
});

test('platform admin sees only privacy-safe aggregates', async ({ page }) => {
  test.skip(!adminEmail || !adminPassword, 'E2E admin credentials are not configured');
  await login(page, adminEmail!, adminPassword!);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Адміністрування платформи' })).toBeVisible();
  await expect(page.getByRole('link', { name: /діалоги|замовлення/i })).toHaveCount(0);
  await expect(page.getByText(/телефон|адреса|повідомлення клієнта/i)).toHaveCount(0);
});

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

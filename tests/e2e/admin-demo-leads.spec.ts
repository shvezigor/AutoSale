import { expect, test } from '@playwright/test';

const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;

test('public demo form displays a localized throttling error without losing values', async ({ page }) => {
  await page.route('**/api/demo-leads', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ code: 'DEMO_LEAD_RATE_LIMITED' }) }));
  await page.goto('/uk/demo');
  await page.getByLabel('Ім’я').fill('Вигадана Людина');
  await page.getByLabel('Компанія або магазин').fill('Вигаданий магазин');
  await page.getByLabel('Email').fill('fictional@example.test');
  await page.getByLabel('Замовлень на місяць').selectOption('50_TO_300');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Замовити демо' }).click();
  await expect(page.locator('.demo-form__status')).toContainText('Забагато запитів.');
  await expect(page.getByLabel('Компанія або магазин')).toHaveValue('Вигаданий магазин');
  await page.screenshot({ path: test.info().outputPath('demo-rate-limit.png') });
});

test('public demo form explains a temporary service outage without losing values', async ({ page }) => {
  await page.route('**/api/demo-leads', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'DEMO_LEAD_UNAVAILABLE' }) }));
  await page.goto('/uk/demo');
  await page.getByLabel('Ім’я').fill('Вигадана Людина');
  await page.getByLabel('Компанія або магазин').fill('Вигаданий магазин');
  await page.getByLabel('Email').fill('fictional@example.test');
  await page.getByLabel('Замовлень на місяць').selectOption('50_TO_300');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Замовити демо' }).click();
  await expect(page.locator('.demo-form__status')).toContainText('тимчасово');
  await expect(page.getByLabel('Компанія або магазин')).toHaveValue('Вигаданий магазин');
});

test('platform demo-lead queue survives reload and exposes masked contacts only', async ({ page }) => {
  test.skip(!adminEmail || !adminPassword, 'Platform-admin test credentials are not configured');
  await page.goto('/login');
  await page.getByLabel('Email').fill(adminEmail!);
  await page.getByLabel('Пароль').fill(adminPassword!);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/admin/leads');
  await expect(page.getByRole('heading', { name: 'Демозаявки' })).toBeVisible();
  await expect(page.locator('.admin-data-table')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Демозаявки' })).toBeVisible();
  await expect(page.locator('.admin-data-table')).toBeVisible();
});

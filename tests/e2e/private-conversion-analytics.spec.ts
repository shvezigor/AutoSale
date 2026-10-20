import { expect, test } from '@playwright/test';

const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;

test('pricing signals disclose only the strict anonymous event fields', async ({ page }) => {
  const bodies: unknown[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/conversion/events') bodies.push(request.postDataJSON());
  });
  await page.goto('/uk/pricing?source=fictional-private-token');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('30 днів');
  await expect.poll(() => bodies.length).toBeGreaterThanOrEqual(1);
  await page.locator('.pricing-card').filter({ has: page.getByRole('heading', { name: 'Growth' }) }).getByRole('link', { name: 'Почати 30 днів' }).click();
  await expect(page).toHaveURL(/\/register/);
  await expect.poll(() => bodies.length).toBeGreaterThanOrEqual(3);
  expect(bodies).toContainEqual({ event: 'pricing_view', locale: 'uk' });
  expect(bodies).toContainEqual({ event: 'plan_interest', locale: 'uk', planId: 'growth' });
  expect(bodies).toContainEqual({ event: 'registration_arrival', locale: 'uk' });
  expect(JSON.stringify(bodies)).not.toMatch(/fictional-private-token|email|phone|message|https?:/i);
});

test('platform conversion report is aggregate-only after reload', async ({ page }) => {
  test.skip(!adminEmail || !adminPassword, 'Platform-admin test credentials are not configured');
  await page.goto('/login');
  await page.getByLabel('Email').fill(adminEmail!);
  await page.getByLabel('Пароль').fill(adminPassword!);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/admin/conversions');
  await expect(page.getByRole('heading', { name: 'Конверсії' })).toBeVisible();
  await expect(page.getByText('Значення менші за 3 приховано.', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Конверсії' })).toBeVisible();
  const report = await page.locator('.admin-page').innerText();
  expect(report).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}|\+?\d{10,}/i);
});

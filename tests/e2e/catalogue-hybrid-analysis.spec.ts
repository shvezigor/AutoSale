import { expect, test, type Page } from '@playwright/test';

const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;
const runLive = process.env.E2E_CATALOGUE_HYBRID_LIVE === '1';
const expectedProduct = process.env.E2E_CATALOGUE_EXPECTED_PRODUCT;

test('live supplier sheet is analysed and imported without mandatory preview', async ({ page }) => {
  test.skip(!runLive || !ownerEmail || !ownerPassword || !expectedProduct, 'Live hybrid catalogue acceptance is explicitly disabled');
  await login(page, ownerEmail!, ownerPassword!);
  await page.goto('/settings?tab=data');

  await page.getByRole('button', { name: 'Завантажити товари' }).click();
  await expect(page.getByText(/Читаємо таблицю|Розпізнаємо структуру таблиці|Перевіряємо товарні рядки|Завантажуємо товари/)).toBeVisible();
  await expect(page.getByText('Готово')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('link', { name: 'Перевірити сумнівні поля' })).toHaveCount(0);

  await page.goto('/catalogue');
  await page.getByPlaceholder(/Артикул, назва або alias/i).fill(expectedProduct!);
  await page.getByRole('button', { name: 'Знайти' }).click();
  await expect(page.getByText(expectedProduct!, { exact: false })).toBeVisible();
});

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

import { expect, test, type Page } from '@playwright/test';

const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;
const runLiveGoogle = process.env.E2E_GOOGLE_LIVE === '1';
const testSpreadsheetName = process.env.E2E_GOOGLE_SPREADSHEET_NAME;

test.beforeEach(async ({ page }) => {
  test.skip(!ownerEmail || !ownerPassword, 'E2E owner credentials are not configured');
  await login(page, ownerEmail!, ownerPassword!);
});

test('owner sees the Google connection wizard without credential fields', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Google-акаунт' })).toBeVisible();
  await expect(page.getByText(/refresh token|client secret|service account json/i)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Google Sheets' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Google Sheets джерело' })).toBeVisible();
});

test('live owner selects a private spreadsheet and validates order export', async ({ page }) => {
  test.skip(!runLiveGoogle || !testSpreadsheetName, 'Live Google acceptance is explicitly disabled');

  await page.goto('/settings');
  await expect(page.getByText('Google підключено')).toBeVisible();

  await page.getByRole('button', { name: 'Обрати Google таблицю' }).last().click();
  const picker = page.frameLocator('iframe[src*="docs.google.com/picker"]');
  await picker.getByText(testSpreadsheetName!, { exact: true }).click();
  await picker.getByRole('button', { name: /select|обрати/i }).click();

  await expect(page.getByText('Таблицю перевірено. Оберіть вкладку та збережіть.')).toBeVisible();
  await page.getByRole('button', { name: 'Зберегти Google Sheets' }).click();
  await page.getByRole('button', { name: 'Перевірити доступ' }).last().click();
  await expect(page.getByText('Підключення активне')).toBeVisible();
});

test('revoked grant is shown as an actionable reconnect state', async ({ page }) => {
  test.skip(!runLiveGoogle, 'Live Google acceptance is explicitly disabled');
  await page.goto('/settings');
  const reconnect = page.getByRole('button', { name: 'Підключити повторно' });
  test.skip(await reconnect.count() === 0, 'The staging Google grant has not been revoked');
  await expect(reconnect).toBeEnabled();
  await expect(page.getByText(/відкликав доступ|потребує вашої уваги/i)).toBeVisible();
});

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

import { test, expect } from '@playwright/test';
import path from 'node:path';

test.beforeEach(async ({ request, page }) => {
  for (const variant of ['react', 'a2ui']) await request.post(`/__prototype/${variant}/reset`, { data: {} });
  await page.goto('/');
  await expect(page.getByText('Без підтвердження', { exact: true })).toHaveCount(2);
});

for (const [variant, name] of [['react', 'React-картка'], ['a2ui', 'A2UI-картка']]) {
  test(`${variant}: confirmation, pending lock and reload`, async ({ page, request }) => {
    const card = page.getByRole('region', { name, exact: true });
    const pageErrors: string[] = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.getByRole('button', { name: 'Перевіряти кожне замовлення', exact: true }).click();
    expect((await (await request.get(`/__prototype/${variant}`)).json()).approvalMode).toBe('NEVER');
    const confirm = card.getByRole('button', { name: 'Підтвердити зміну', exact: true });
    await confirm.click();
    await expect(card.getByRole('button', { name: 'Застосовуємо…', exact: true })).toBeDisabled();
    await expect(card.getByText('Зміну збережено в локальному прототипі.')).toBeVisible();
    const saved = await (await request.get(`/__prototype/${variant}`)).json();
    expect(saved).toMatchObject({ approvalMode: 'ALWAYS', revision: 2, intentDetectionMode: 'AI_SUGGESTION' });
    await page.reload();
    await expect(card.locator('dd').first()).toHaveText('Підтвердження менеджером');
    await page.getByRole('button', { name: 'Перевіряти кожне замовлення', exact: true }).click();
    await expect(confirm).toBeDisabled();
    expect(pageErrors).toEqual([]);
  });

  for (const [environment, status, message] of [
    ['forbidden', 403, 'Змінювати ці налаштування може лише власник компанії.'],
    ['conflict', 409, 'Налаштування змінилися. Оновіть дані та перегляньте пропозицію ще раз.'],
    ['outage', 503, 'Сервіс тимчасово недоступний. Спробуйте підтвердити пізніше.'],
  ] as const) {
    test(`${variant}: ${status} preserves settings and allows recovery`, async ({ page, request }) => {
      const card = page.getByRole('region', { name, exact: true });
      await page.getByLabel('Сценарій підтвердження').selectOption(environment);
      await page.getByRole('button', { name: 'Перевіряти кожне замовлення', exact: true }).click();
      await card.getByRole('button', { name: 'Підтвердити зміну', exact: true }).click();
      await expect(card.getByRole('alert')).toHaveText(message);
      expect((await (await request.get(`/__prototype/${variant}`)).json()).approvalMode).toBe('NEVER');
      await page.getByLabel('Сценарій підтвердження').selectOption('success');
      await card.getByRole('button', { name: 'Підтвердити зміну', exact: true }).click();
      await expect(card.getByText('Зміну збережено в локальному прототипі.')).toBeVisible();
    });
  }
  test(`${variant}: cancel and unchanged proposal`, async ({ page, request }) => {
    const card = page.getByRole('region', { name, exact: true });
    await page.getByRole('button', { name: 'Перевіряти кожне замовлення', exact: true }).click();
    await card.getByRole('button', { name: 'Скасувати', exact: true }).click();
    await expect(card.getByText('Пропозицію скасовано. Налаштування без змін.')).toBeVisible();
    expect((await (await request.get(`/__prototype/${variant}`)).json()).revision).toBe(1);
    await page.getByRole('button', { name: 'AI лише пропонує', exact: true }).click();
    await expect(card.getByText('Цей режим уже встановлено. Зберігати нічого не потрібно.', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Підтвердити зміну', exact: true })).toBeDisabled();
  });
}

test('localized validation, keyboard submission and variant URL', async ({ page }) => {
  const input = page.getByLabel('Що змінити в налаштуваннях?');
  await page.getByRole('button', { name: 'Показати пропозицію', exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input).toHaveAttribute('aria-describedby', 'prompt-error');
  await input.fill('Невідомий запит');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await input.press('Enter');
  await expect(input).toHaveValue('Невідомий запит');
  await expect(page.getByRole('alert')).toContainText('доступні два приклади');
  await input.fill('Хочу перевіряти кожне замовлення');
  await input.press('Enter');
  await expect(page.getByRole('heading', { name: 'Перевірка кожного замовлення' })).toHaveCount(2);
  await page.getByRole('button', { name: 'B · A2UI', exact: true }).click();
  await expect(page).toHaveURL(/variant=a2ui/);
  await page.reload();
  await expect(page.getByRole('region', { name: 'React-картка', exact: true })).toBeHidden();
});

test('responsive browser evidence and keyboard confirmation', async ({ page }) => {
  await page.getByRole('button', { name: 'Перевіряти кожне замовлення', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Перевірка кожного замовлення' })).toHaveCount(2);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1080 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.resolve(process.env.PROTOTYPE_EVIDENCE_DIR ?? 'test-results', `settings-assistant-${width}.png`), fullPage: true });
  }
  for (const name of ['React-картка', 'A2UI-картка']) {
    const button = page.getByRole('region', { name, exact: true }).getByRole('button', { name: 'Підтвердити зміну', exact: true });
    await button.focus();
    await button.press('Enter');
    await expect(page.getByRole('region', { name, exact: true }).getByText('Зміну збережено в локальному прототипі.')).toBeVisible();
  }
});

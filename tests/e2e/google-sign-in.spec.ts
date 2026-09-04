import { expect, test } from '@playwright/test';

test('login and registration expose Google Sign-In without removing password auth', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Продовжити з Google' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Пароль')).toBeVisible();

  await page.goto('/register');
  await expect(page.getByRole('button', { name: 'Продовжити з Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Зареєструватися' })).toBeVisible();
});

test('expired Google onboarding exposes only a safe restart', async ({ page }) => {
  await page.goto('/onboarding/google');
  await expect(page.getByRole('heading', { name: 'Посилання протерміновано' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Почати знову' })).toHaveAttribute('href', '/login');
  await expect(page.getByLabel('Email')).toHaveCount(0);
});

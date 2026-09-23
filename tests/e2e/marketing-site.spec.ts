import { expect, test } from '@playwright/test';

test.describe('Sales AITO marketing site', () => {
  test('serves indexable Ukrainian content and a complete hero image', async ({ page }) => {
    await page.goto('/uk');
    await expect(page).toHaveTitle(/AI-оператор продажів/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://sales-aito.com/uk');
    await expect(page.locator('link[hreflang="en"]')).toHaveAttribute('href', 'https://sales-aito.com/en');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Продажі з діалогів');
    await expect(page.locator('.marketing-hero__visual img')).toHaveJSProperty('complete', true);
    await expect.poll(() => page.locator('.marketing-hero__visual img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  });

  test('switches to equivalent English content', async ({ page }) => {
    await page.goto('/uk/pricing');
    await page.getByRole('link', { name: 'Switch to English' }).click();
    await expect(page).toHaveURL(/\/en\/pricing$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('30 days free');
  });

  test('has no horizontal overflow across key viewports', async ({ page }) => {
    await page.goto('/uk');
    for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });

  test('submits the demo form with an idempotency key and shows success', async ({ page }) => {
    let receivedKey = '';
    await page.route('**/api/demo-leads', async (route) => { receivedKey = route.request().headers()['idempotency-key'] ?? ''; await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'lead', accepted: true }) }); });
    await page.goto('/en/demo');
    await page.getByLabel('Name').fill('Test User');
    await page.getByLabel('Company or store').fill('Test Store');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Monthly orders').selectOption('50_TO_300');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Book a demo' }).click();
    await expect(page.getByRole('heading', { name: 'Request received' })).toBeVisible();
    expect(receivedKey.length).toBeGreaterThan(10);
  });

  test('explains invalid demo fields without overflow or losing entered values', async ({ page }) => {
    await page.goto('/uk/demo');
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 850 });
      await page.getByLabel('Ім’я').fill('А');
      await page.getByLabel('Компанія або магазин').fill('Тестовий магазин');
      await page.getByRole('button', { name: 'Замовити демо' }).click();
      await expect(page.getByLabel('Ім’я')).toBeFocused();
      await expect(page.getByLabel('Ім’я')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#demo-name-error')).toBeVisible();
      await expect(page.locator('#demo-orderVolume-error')).toBeVisible();
      await expect(page.getByLabel('Компанія або магазин')).toHaveValue('Тестовий магазин');
      const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
      await page.getByLabel('Ім’я').fill('Олена');
      await expect(page.locator('#demo-name-error')).toHaveCount(0);
      await expect(page.locator('#demo-orderVolume-error')).toBeVisible();
    }
  });
});
